import math
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from common import listing_json, listings_json, owned
from deps import current_user, get_db, require_role
from models import GeocodeCache, Listing, ListingMedia, Media

router = APIRouter()
CATEGORIES = {"services", "spaces", "equipment", "delivery", "travel"}
REQUIRED = {
    "equipment": {"equipmentType", "condition", "fuelType"},
    "services": {"serviceType", "experienceYears", "onSiteOrRemote"},
    "travel": {"vehicleType", "seatingCapacity", "withDriver", "originLabel",
               "originLatitude", "originLongitude", "destinationLabel",
               "destinationLatitude", "destinationLongitude", "departureAt", "availableSeats"},
    "delivery": {"vehicleType", "maxLoadCapacity", "serviceRadiusKm"},
    "spaces": {"capacity", "spaceType"},
}


class ListingBody(BaseModel):
    category: Literal["services", "spaces", "equipment", "delivery", "travel"]
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=4000)
    price: float = Field(ge=0)
    pricingMode: Literal["fixed", "negotiable"]
    currency: Literal["INR"] = "INR"
    locationLabel: str = Field(min_length=2, max_length=300)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    attributes: dict[str, Any]
    photoIds: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def attributes_valid(self):
        if set(self.attributes) != REQUIRED[self.category]:
            raise ValueError(f"attributes must contain exactly {sorted(REQUIRED[self.category])}")
        a = self.attributes
        try:
            if self.category == "services":
                if not isinstance(a["serviceType"], str) or type(a["experienceYears"]) is not int or a["experienceYears"] < 0:
                    raise ValueError
                if a["onSiteOrRemote"] not in {"onSite", "remote", "both"}: raise ValueError
            elif self.category == "spaces":
                if type(a["capacity"]) is not int or a["capacity"] < 1 or not isinstance(a["spaceType"], str): raise ValueError
            elif self.category == "equipment":
                if not all(isinstance(a[x], str) and a[x] for x in REQUIRED["equipment"]): raise ValueError
            elif self.category == "delivery":
                if not isinstance(a["vehicleType"], str) or float(a["maxLoadCapacity"]) < 0 or float(a["serviceRadiusKm"]) < 0: raise ValueError
            elif self.category == "travel":
                if type(a["seatingCapacity"]) is not int or a["seatingCapacity"] < 1: raise ValueError
                if type(a["availableSeats"]) is not int or not 0 <= a["availableSeats"] <= a["seatingCapacity"]: raise ValueError
                if type(a["withDriver"]) is not bool: raise ValueError
                if not all(isinstance(a[x], str) and a[x] for x in
                           ("vehicleType", "originLabel", "destinationLabel")): raise ValueError
                if not (-90 <= float(a["originLatitude"]) <= 90 and -180 <= float(a["originLongitude"]) <= 180
                        and -90 <= float(a["destinationLatitude"]) <= 90 and -180 <= float(a["destinationLongitude"]) <= 180): raise ValueError
                departure = datetime.fromisoformat(str(a["departureAt"]).replace("Z", "+00:00"))
                if departure.tzinfo is None: raise ValueError
        except (KeyError, TypeError, ValueError):
            raise ValueError("Invalid category attribute values")
        return self


class ListingPatch(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=120)
    description: str | None = Field(None, min_length=10, max_length=4000)
    price: float | None = Field(None, ge=0)
    pricingMode: Literal["fixed", "negotiable"] | None = None
    locationLabel: str | None = Field(None, min_length=2, max_length=300)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    attributes: dict[str, Any] | None = None
    photoIds: list[str] | None = Field(None, max_length=6)
    status: Literal["active", "paused"] | None = None


def _photos(db, user, ids):
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Duplicate photo IDs")
    result = [db.get(Media, x) for x in ids]
    if any(not x or x.owner_id != user.id or x.purpose != "listingPhoto" or x.status != "ready" for x in result):
        raise HTTPException(422, "Every photo must be your finalized listing photo")
    return result


def _set_photos(db, listing, ids):
    db.query(ListingMedia).filter(ListingMedia.listing_id == listing.id).delete()
    for position, media_id in enumerate(ids):
        db.add(ListingMedia(listing_id=listing.id, media_id=media_id, position=position))


@router.post("/listings", status_code=201)
def create(body: ListingBody, db: Session = Depends(get_db), user=Depends(require_role("provider"))):
    _photos(db, user, body.photoIds)
    data = body.model_dump(exclude={"photoIds"})
    mapping = {"pricingMode": "pricing_mode", "locationLabel": "location_label"}
    data = {mapping.get(k, k): v for k, v in data.items()}
    listing = Listing(provider_id=user.id, **data)
    db.add(listing)
    db.flush()
    _set_photos(db, listing, body.photoIds)
    db.flush()
    return listing_json(db, listing)


@router.get("/my/listings")
def mine(db: Session = Depends(get_db), user=Depends(require_role("provider"))):
    rows = db.scalars(select(Listing).where(
        Listing.provider_id == user.id, Listing.status != "archived").order_by(Listing.created_at.desc()))
    return {"items": listings_json(db, ((x, None) for x in rows))}


@router.get("/listings")
def search(db: Session = Depends(get_db), user=Depends(current_user),
           category: str | None = None, search: str | None = None,
           priceMin: float | None = Query(None, ge=0), priceMax: float | None = Query(None, ge=0),
           lat: float | None = Query(None, ge=-90, le=90), lng: float | None = Query(None, ge=-180, le=180),
           distanceKm: float = Query(25, ge=1, le=500), sort: str = "relevance",
           limit: int = Query(30, ge=1, le=100),
           originLat: float | None = Query(None, ge=-90, le=90),
           originLng: float | None = Query(None, ge=-180, le=180),
           destinationLat: float | None = Query(None, ge=-90, le=90),
           destinationLng: float | None = Query(None, ge=-180, le=180),
           departureFrom: datetime | None = None, departureTo: datetime | None = None,
           seats: int | None = Query(None, ge=1)):
    if category and category not in CATEGORIES:
        raise HTTPException(422, "Unknown category")
    stmt = select(Listing).where(Listing.status == "active")
    if category: stmt = stmt.where(Listing.category == category)
    if search:
        term = f"%{search[:100]}%"
        stmt = stmt.where(or_(Listing.title.ilike(term), Listing.description.ilike(term)))
    if priceMin is not None: stmt = stmt.where(Listing.price >= priceMin)
    if priceMax is not None: stmt = stmt.where(Listing.price <= priceMax)
    if lat is not None and lng is not None:
        stmt = stmt.where(bounding_box(lat, lng, distanceKm))
    if sort == "priceLow": stmt = stmt.order_by(Listing.price)
    elif sort == "priceHigh": stmt = stmt.order_by(Listing.price.desc())
    elif sort not in {"relevance", "distance"}: raise HTTPException(422, "Unknown sort")
    rows = list(db.scalars(stmt.limit(500)))
    output = []
    for row in rows:
        if row.category == "travel" and any(x is not None for x in
                (originLat, originLng, destinationLat, destinationLng, departureFrom, departureTo, seats)):
            attrs = row.attributes
            try:
                departure = datetime.fromisoformat(attrs["departureAt"].replace("Z", "+00:00"))
                if departureFrom and departure < departureFrom: continue
                if departureTo and departure > departureTo: continue
                if seats and int(attrs["availableSeats"]) < seats: continue
                if originLat is not None and originLng is not None:
                    if 111 * math.sqrt((float(attrs["originLatitude"])-originLat)**2 +
                        (float(attrs["originLongitude"])-originLng)**2) > distanceKm: continue
                if destinationLat is not None and destinationLng is not None:
                    if 111 * math.sqrt((float(attrs["destinationLatitude"])-destinationLat)**2 +
                        (float(attrs["destinationLongitude"])-destinationLng)**2) > distanceKm: continue
            except (KeyError, TypeError, ValueError):
                continue
        distance = None
        if lat is not None and lng is not None:
            distance = haversine_km(lat, lng, row.latitude, row.longitude)
            if distance > distanceKm: continue
        output.append((row, distance))
    if sort == "distance":
        if lat is None or lng is None: raise HTTPException(422, "Coordinates required for distance sort")
        output.sort(key=lambda x: x[1])
    return {"items": listings_json(db, output[:limit]), "nextCursor": None}


@router.get("/listings/{listing_id}")
def get_listing(listing_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    listing = db.get(Listing, listing_id)
    if not listing or listing.status == "archived" or (listing.status != "active" and listing.provider_id != user.id):
        raise HTTPException(404, "Listing not found")
    listing.view_count += 1
    db.flush()
    return listing_json(db, listing)


@router.patch("/listings/{listing_id}")
def update(listing_id: str, body: ListingPatch, db: Session = Depends(get_db), user=Depends(require_role("provider"))):
    listing = owned(db, Listing, listing_id, user)
    if listing.status == "archived":
        raise HTTPException(404, "Listing not found")
    values = body.model_dump(exclude_unset=True)
    photos = values.pop("photoIds", None)
    attrs = values.get("attributes")
    if attrs is not None and set(attrs) != REQUIRED[listing.category]:
        raise HTTPException(422, "Invalid category attributes")
    mapping = {"pricingMode": "pricing_mode", "locationLabel": "location_label"}
    for key, value in values.items(): setattr(listing, mapping.get(key, key), value)
    if photos is not None:
        _photos(db, user, photos)
        _set_photos(db, listing, photos)
    db.flush()
    return listing_json(db, listing)


@router.delete("/listings/{listing_id}", status_code=204)
def delete(listing_id: str, db: Session = Depends(get_db), user=Depends(require_role("provider"))):
    listing = owned(db, Listing, listing_id, user)
    listing.status = "archived"


EARTH_RADIUS_KM = 6371.0
KM_PER_DEGREE_LAT = 111.32
HOME_MAX_RESULTS = 200


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlng = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def bounding_box(lat, lng, radius_km):
    """SQL predicate selecting listings inside a lat/lng box that fully
    contains the search circle. Uses the (latitude, longitude) indexes; exact
    great-circle distance is checked afterwards on the few candidates.
    Future scaling path: PostGIS geography + GiST index + ST_DWithin."""
    dlat = radius_km / KM_PER_DEGREE_LAT
    conditions = [Listing.latitude.between(max(-90.0, lat - dlat), min(90.0, lat + dlat))]
    cos_lat = math.cos(math.radians(lat))
    if cos_lat > 1e-6 and abs(lat) + dlat < 90:
        dlng = radius_km / (KM_PER_DEGREE_LAT * cos_lat)
        if dlng < 180:
            west, east = lng - dlng, lng + dlng
            if west < -180:
                conditions.append(or_(Listing.longitude >= west + 360, Listing.longitude <= east))
            elif east > 180:
                conditions.append(or_(Listing.longitude >= west, Listing.longitude <= east - 360))
            else:
                conditions.append(Listing.longitude.between(west, east))
    # Near the poles or for huge radii the box spans every longitude.
    return and_(*conditions)


def map_pin_json(listing, distance):
    """Compact projection for map pins (no provider/photo lookups, no description)."""
    return dict(id=listing.id, providerId=listing.provider_id, category=listing.category,
                title=listing.title, price=listing.price, pricingMode=listing.pricing_mode,
                currency=listing.currency, latitude=listing.latitude,
                longitude=listing.longitude, status=listing.status, distanceKm=distance)


@router.get("/home/summary")
def home(db: Session = Depends(get_db), user=Depends(current_user),
         lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
         lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
         distanceKm: Annotated[float, Query(gt=0, le=500)] = 25,
         view: Literal["full", "map"] = "full"):
    counts = {category: count for category, count in db.execute(
        select(Listing.category, func.count()).where(
            Listing.status == "active").group_by(Listing.category))}
    categories = [{"category": x, "count": counts.get(x, 0)} for x in sorted(CATEGORIES)]
    stmt = select(Listing).where(Listing.status == "active")
    nearby = []
    if lat is not None and lng is not None:
        # Nearest-first by a cheap planar approximation so LIMIT keeps the
        # closest candidates; exact haversine below trims the box corners.
        cos_lat = math.cos(math.radians(lat))
        approx = ((Listing.latitude - lat) * (Listing.latitude - lat) +
                  (Listing.longitude - lng) * (Listing.longitude - lng) * (cos_lat * cos_lat))
        rows = db.scalars(stmt.where(bounding_box(lat, lng, distanceKm))
                          .order_by(approx, Listing.id).limit(HOME_MAX_RESULTS * 2))
        for row in rows:
            distance = haversine_km(lat, lng, row.latitude, row.longitude)
            if distance <= distanceKm:
                nearby.append((row, round(distance, 3)))
        nearby.sort(key=lambda item: item[1])
        nearby = nearby[:HOME_MAX_RESULTS]
    else:
        # Without coordinates keep the historical oldest-first sample of 100.
        rows = db.scalars(stmt.order_by(Listing.created_at, Listing.id).limit(100))
        nearby = [(row, None) for row in rows]
    listings = ([map_pin_json(row, distance) for row, distance in nearby] if view == "map"
                else listings_json(db, nearby))
    return {"totalListings": sum(counts.values()), "categories": categories,
            "nearbyListings": listings}


@router.get("/geocode")
def geocode(q: str = Query(min_length=3, max_length=200), db: Session = Depends(get_db), user=Depends(current_user)):
    key = " ".join(q.lower().split())
    cached = db.get(GeocodeCache, key)
    if cached and cached.fetched_at.replace(tzinfo=cached.fetched_at.tzinfo or timezone.utc) > datetime.now(timezone.utc)-timedelta(days=30):
        return {"results": cached.results}
    try:
        response = httpx.get("https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "jsonv2", "limit": 5},
            headers={"User-Agent": os.getenv("NOMINATIM_USER_AGENT", "Pontreol/1.0 (https://pontreol.com)")},
            timeout=8)
        response.raise_for_status()
        results = [{"label": x["display_name"], "latitude": float(x["lat"]), "longitude": float(x["lon"])}
                   for x in response.json()]
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(503, "Geocoding service is temporarily unavailable")
    db.merge(GeocodeCache(query=key, results=results))
    return {"results": results}