import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
import httpx

from common import iso
from deps import current_user, get_db, require_role
from models import (Availability, Booking, Listing, Notification,
                    NotificationOutbox, Review, User)

router = APIRouter()


def booking_json(x):
    return dict(id=x.id, listingId=x.listing_id, buyerId=x.buyer_id,
                providerId=x.provider_id, category=x.category, status=x.status,
                details=x.details, quotedPrice=x.quoted_price,
                createdAt=iso(x.created_at), updatedAt=iso(x.updated_at))


def participant(db, booking_id, user, lock=False):
    stmt = select(Booking).where(Booking.id == booking_id)
    if lock: stmt = stmt.with_for_update()
    booking = db.scalar(stmt)
    if not booking or user.id not in {booking.buyer_id, booking.provider_id}:
        raise HTTPException(404, "Booking not found")
    return booking


def notify(db, user_id, kind, title, body, booking):
    db.add(Notification(user_id=user_id, type=kind, title=title, body=body,
                        resource_type="booking", resource_id=booking.id))
    recipient = db.get(User, user_id)
    if recipient:
        db.add(NotificationOutbox(user_id=user_id, recipient=recipient.email,
            subject=title, body=body))


class ServiceBody(BaseModel):
    listingId: str
    requestedAt: datetime
    note: str | None = Field(None, max_length=1000)

    @model_validator(mode="after")
    def valid(self):
        if self.requestedAt.tzinfo is None: raise ValueError("Timezone-aware requestedAt required")
        return self


class SpaceBody(BaseModel):
    listingId: str
    mode: Literal["daily", "hourly"]
    checkIn: datetime
    checkOut: datetime
    note: str | None = Field(None, max_length=1000)

    @model_validator(mode="after")
    def valid(self):
        if not self.checkIn.tzinfo or not self.checkOut.tzinfo or self.checkOut <= self.checkIn:
            raise ValueError("Timezone-aware increasing range required")
        return self


class EquipmentBody(BaseModel):
    listingId: str
    startsAt: datetime
    endsAt: datetime
    operatorRequested: bool
    note: str | None = Field(None, max_length=1000)

    @model_validator(mode="after")
    def valid(self):
        if not self.startsAt.tzinfo or not self.endsAt.tzinfo or self.endsAt <= self.startsAt:
            raise ValueError("Timezone-aware increasing range required")
        return self


class DeliveryBody(BaseModel):
    listingId: str
    pickup: dict
    dropoff: dict
    pickupAt: datetime
    itemDescription: str = Field(min_length=1, max_length=1000)
    loadKg: float | None = Field(None, ge=0)
    note: str | None = Field(None, max_length=1000)

    @model_validator(mode="after")
    def valid(self):
        if self.pickupAt.tzinfo is None: raise ValueError("Timezone-aware pickupAt required")
        for location in (self.pickup, self.dropoff):
            if set(location) != {"label", "latitude", "longitude"}:
                raise ValueError("Locations require label, latitude and longitude")
            if not isinstance(location["label"], str) or not (-90 <= float(location["latitude"]) <= 90) or not (-180 <= float(location["longitude"]) <= 180):
                raise ValueError("Invalid location")
        return self


class TravelBody(BaseModel):
    listingId: str
    seats: int = Field(ge=1)
    note: str | None = Field(None, max_length=1000)


def create_booking(db, user, listing_id, category, details, starts=None, ends=None, seats=None):
    listing = db.scalar(select(Listing).where(Listing.id == listing_id).with_for_update())
    if not listing or listing.status != "active" or listing.category != category:
        raise HTTPException(404, "Active category listing not found")
    if listing.provider_id == user.id:
        raise HTTPException(409, "You cannot book your own listing")
    if starts and ends:
        configured = db.scalar(select(Availability.id).where(
            Availability.listing_id == listing.id,
            Availability.starts_at <= starts, Availability.ends_at >= ends).limit(1))
        if not configured:
            raise HTTPException(409, "Requested time is outside provider availability")
        conflict = db.scalar(select(Booking.id).where(
            Booking.listing_id == listing.id,
            Booking.status.in_(["requested", "quoted", "confirmed"]),
            Booking.details["startsAt"].as_string() < ends.isoformat(),
            Booking.details["endsAt"].as_string() > starts.isoformat()).limit(1))
        if conflict: raise HTTPException(409, "Requested time is unavailable")
        details["startsAt"], details["endsAt"] = starts.isoformat(), ends.isoformat()
    if seats:
        available = int(listing.attributes.get("availableSeats", 0))
        if seats > available: raise HTTPException(409, "Not enough seats remain")
        attrs = dict(listing.attributes)
        attrs["availableSeats"] = available - seats
        listing.attributes = attrs
    status = "confirmed" if category == "services" and listing.pricing_mode == "fixed" else "requested"
    booking = Booking(listing_id=listing.id, buyer_id=user.id,
        provider_id=listing.provider_id, category=category, status=status, details=details)
    db.add(booking); db.flush()
    notify(db, listing.provider_id, "booking", "New booking request", listing.title, booking)
    return booking_json(booking)


@router.post("/bookings/services", status_code=201)
def service(body: ServiceBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    return create_booking(db, user, body.listingId, "services",
                          {"requestedAt": body.requestedAt.isoformat(), "note": body.note})


@router.post("/bookings/spaces", status_code=201)
def space(body: SpaceBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    return create_booking(db, user, body.listingId, "spaces",
                          {"mode": body.mode, "note": body.note}, body.checkIn, body.checkOut)


@router.post("/bookings/equipment", status_code=201)
def equipment(body: EquipmentBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    return create_booking(db, user, body.listingId, "equipment",
                          {"operatorRequested": body.operatorRequested, "note": body.note},
                          body.startsAt, body.endsAt)


@router.post("/bookings/delivery", status_code=201)
def delivery(body: DeliveryBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    return create_booking(db, user, body.listingId, "delivery", body.model_dump(exclude={"listingId"}, mode="json"))


@router.post("/bookings/travel", status_code=201)
def travel(body: TravelBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    return create_booking(db, user, body.listingId, "travel",
                          {"seats": body.seats, "note": body.note}, seats=body.seats)


class QuoteBody(BaseModel):
    quotedPrice: float = Field(ge=0)
    message: str | None = Field(None, max_length=1000)


@router.post("/bookings/{booking_id}/quote")
def quote(booking_id: str, body: QuoteBody, db: Session = Depends(get_db), user=Depends(require_role("provider"))):
    booking = participant(db, booking_id, user, True)
    if booking.provider_id != user.id or booking.category != "services" or booking.status != "requested":
        raise HTTPException(409, "This booking cannot be quoted")
    booking.quoted_price, booking.status = body.quotedPrice, "quoted"
    notify(db, booking.buyer_id, "booking", "Quote received", body.message or "A provider sent a quote", booking)
    return booking_json(booking)


class QuoteResponse(BaseModel):
    accept: bool


@router.post("/bookings/{booking_id}/quote-response")
def quote_response(booking_id: str, body: QuoteResponse, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    booking = participant(db, booking_id, user, True)
    if booking.buyer_id != user.id or booking.status != "quoted":
        raise HTTPException(409, "This quote cannot be answered")
    booking.status = "confirmed" if body.accept else "declined"
    return booking_json(booking)


@router.get("/bookings")
def list_bookings(db: Session = Depends(get_db), user=Depends(current_user),
                  category: str | None = None, status: str | None = None):
    stmt = select(Booking).where(or_(Booking.buyer_id == user.id, Booking.provider_id == user.id))
    if category: stmt = stmt.where(Booking.category == category)
    if status: stmt = stmt.where(Booking.status == status)
    rows = db.scalars(stmt.order_by(Booking.created_at.desc()))
    return {"items": [booking_json(x) for x in rows], "nextCursor": None}


# Delivery pickup/dropoff points are fixed per booking, so the public OSRM
# route is cached in-process instead of re-requested on every detail view.
_ROUTE_TTL_SECONDS = 3600
_ROUTE_CACHE_MAX = 256
_route_cache: dict[str, tuple[float, dict]] = {}


def _route_cache_get(key):
    entry = _route_cache.get(key)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    _route_cache.pop(key, None)
    return None


def _route_cache_put(key, route):
    if len(_route_cache) >= _ROUTE_CACHE_MAX:
        _route_cache.pop(next(iter(_route_cache)), None)
    _route_cache[key] = (time.monotonic() + _ROUTE_TTL_SECONDS, route)


@router.get("/bookings/{booking_id}")
def get_booking(booking_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    booking = participant(db, booking_id, user)
    route = None
    if booking.category == "delivery":
        try:
            pickup, dropoff = booking.details["pickup"], booking.details["dropoff"]
            coordinates = (f'{pickup["longitude"]},{pickup["latitude"]};'
                           f'{dropoff["longitude"]},{dropoff["latitude"]}')
            route = _route_cache_get(coordinates)
            if route is None:
                response = httpx.get(f"https://router.project-osrm.org/route/v1/driving/{coordinates}",
                                     params={"overview": "full", "geometries": "geojson"}, timeout=8,
                                     headers={"User-Agent": "Pontreol/1.0 (https://pontreol.com)"})
                response.raise_for_status()
                routes = response.json().get("routes", [])
                if not routes: raise ValueError
                route = {"geometry": routes[0]["geometry"], "provider": "OSRM"}
                _route_cache_put(coordinates, route)
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            raise HTTPException(503, "Free route service is temporarily unavailable")
    return {"booking": booking_json(booking), "route": route}


class StatusBody(BaseModel):
    status: str


@router.post("/bookings/{booking_id}/status")
def set_status(booking_id: str, body: StatusBody, db: Session = Depends(get_db), user=Depends(current_user)):
    booking = participant(db, booking_id, user, True)
    if booking.category == "delivery":
        transitions = {"requested": "pickedUp", "pickedUp": "enRoute", "enRoute": "delivered"}
        if booking.provider_id != user.id or transitions.get(booking.status) != body.status:
            raise HTTPException(409, "Invalid delivery status transition")
    else:
        if booking.status in {"declined", "cancelled", "completed"}:
            raise HTTPException(409, "Booking status is terminal")
        if body.status in {"confirmed", "declined"} and booking.provider_id != user.id:
            raise HTTPException(403, "Only the provider can answer this request")
        if body.status == "cancelled" and user.id not in {booking.buyer_id, booking.provider_id}:
            raise HTTPException(403, "Only a participant can cancel")
        if body.status not in {"confirmed", "declined", "cancelled"}:
            raise HTTPException(409, "Invalid booking status")
        if body.status == "cancelled" and booking.category == "travel":
            listing = db.scalar(select(Listing).where(Listing.id == booking.listing_id).with_for_update())
            attrs = dict(listing.attributes)
            attrs["availableSeats"] = int(attrs["availableSeats"]) + int(booking.details["seats"])
            listing.attributes = attrs
    booking.status = body.status
    return booking_json(booking)


@router.post("/bookings/{booking_id}/complete")
def complete(booking_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    booking = participant(db, booking_id, user, True)
    at = datetime.now(timezone.utc)
    if user.id == booking.buyer_id: booking.buyer_completed_at = at
    else: booking.provider_completed_at = at
    if booking.buyer_completed_at and booking.provider_completed_at: booking.status = "completed"
    return booking_json(booking)