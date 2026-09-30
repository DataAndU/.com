"""Share my trip / job: a customer shares a read-only live status link for a
travel, delivery or service booking with family (e.g. "the electrician is at
my home"). The link reveals no contact details, is stored
only as a hash, expires, and can be revoked."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from common import iso
from deps import current_user, get_db
from models import Booking, Listing, User

router = APIRouter()
SHARE_TTL = timedelta(hours=48)
SHAREABLE = {"travel", "delivery", "services"}


def token_hash(token):
    return hashlib.sha256(("pontreol-trip:" + token).encode()).hexdigest()


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def own_travel_booking(db, booking_id, user):
    booking = db.scalar(select(Booking).where(Booking.id == booking_id).with_for_update())
    if not booking or booking.buyer_id != user.id:
        raise HTTPException(404, "Booking not found")
    if booking.category not in SHAREABLE:
        raise HTTPException(422, "This booking type cannot be shared")
    return booking


def departure_of(listing):
    try:
        return aware(datetime.fromisoformat(str(listing.attributes["departureAt"]).replace("Z", "+00:00")))
    except (KeyError, TypeError, ValueError):
        return None


@router.post("/bookings/{booking_id}/share")
def create_share(booking_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    booking = own_travel_booking(db, booking_id, user)
    if booking.status in {"declined", "cancelled"}:
        raise HTTPException(409, "This trip is no longer active")
    listing = db.get(Listing, booking.listing_id)
    now = datetime.now(timezone.utc)
    departure = departure_of(listing) if listing else None
    # Valid for 48h, or until a day after departure if that is later.
    expires = max(now + SHARE_TTL, departure + timedelta(days=1)) if departure else now + SHARE_TTL
    token = secrets.token_urlsafe(24)
    booking.share_token_hash, booking.share_expires_at = token_hash(token), expires
    db.flush()
    return {"path": f"/trip/{token}", "expiresAt": iso(expires)}


@router.delete("/bookings/{booking_id}/share", status_code=204)
def revoke_share(booking_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    booking = own_travel_booking(db, booking_id, user)
    booking.share_token_hash, booking.share_expires_at = None, None


@router.get("/trips/shared/{token}")
def shared_trip(token: str, db: Session = Depends(get_db)):
    """Public (no sign-in): deliberately minimal, no contact details or ids."""
    missing = HTTPException(404, "This trip link has expired or was switched off")
    if not token or len(token) > 64:
        raise missing
    booking = db.scalar(select(Booking).where(Booking.share_token_hash == token_hash(token)))
    if (not booking or booking.category not in SHAREABLE or not booking.share_expires_at
            or aware(booking.share_expires_at) <= datetime.now(timezone.utc)):
        raise missing
    listing = db.get(Listing, booking.listing_id)
    driver = db.get(User, booking.provider_id)
    attrs = (listing.attributes if listing else {}) or {}
    body = {
        "category": booking.category,
        "service": listing.title if listing and booking.category != "travel" else None,
        "status": booking.status,
        "from": attrs.get("originLabel") if booking.category == "travel" else None,
        "to": attrs.get("destinationLabel") if booking.category == "travel" else None,
        "departureAt": attrs.get("departureAt"),
        "vehicle": attrs.get("vehicleType"),
        "seats": (booking.details or {}).get("seats"),
        "driverFirstName": (driver.display_name.split()[0] if driver and driver.display_name else None),
        "driverVerified": bool(driver and driver.verification_status == "verified"),
        "updatedAt": iso(booking.updated_at),
        "expiresAt": iso(booking.share_expires_at),
    }
    response = JSONResponse(body)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return response
