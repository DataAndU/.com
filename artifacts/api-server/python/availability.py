from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from common import iso, owned
from deps import current_user, get_db, require_role
from models import Availability, Booking, Listing

router = APIRouter()


class Slot(BaseModel):
    startsAt: datetime
    endsAt: datetime

    @model_validator(mode="after")
    def valid(self):
        if not self.startsAt.tzinfo or not self.endsAt.tzinfo or self.endsAt <= self.startsAt:
            raise ValueError("Timezone-aware increasing slot required")
        return self


class AvailabilityBody(BaseModel):
    timezone: str
    slots: list[Slot] = Field(max_length=500)


@router.put("/listings/{listing_id}/availability")
def save(listing_id: str, body: AvailabilityBody, db: Session = Depends(get_db), user=Depends(require_role("provider"))):
    listing = owned(db, Listing, listing_id, user)
    try: ZoneInfo(body.timezone)
    except ZoneInfoNotFoundError: raise HTTPException(422, "Unknown IANA timezone")
    ordered = sorted(body.slots, key=lambda x: x.startsAt)
    if any(a.endsAt > b.startsAt for a, b in zip(ordered, ordered[1:])):
        raise HTTPException(422, "Availability slots overlap")
    db.query(Availability).filter(Availability.listing_id == listing.id).delete()
    for slot in ordered:
        db.add(Availability(listing_id=listing.id, starts_at=slot.startsAt,
                            ends_at=slot.endsAt, timezone=body.timezone))
    return {"timezone": body.timezone, "slots": [{"startsAt": iso(x.startsAt),
             "endsAt": iso(x.endsAt), "available": True} for x in ordered]}


@router.get("/listings/{listing_id}/availability")
def get(listing_id: str, from_: datetime = Query(alias="from"), to: datetime = Query(),
        db: Session = Depends(get_db),
        user=Depends(current_user)):
    if to <= from_: raise HTTPException(422, "Invalid range")
    slots = list(db.scalars(select(Availability).where(
        Availability.listing_id == listing_id, Availability.starts_at < to,
        Availability.ends_at > from_).order_by(Availability.starts_at)))
    bookings = list(db.scalars(select(Booking).where(
        Booking.listing_id == listing_id,
        Booking.status.in_(["requested", "quoted", "confirmed"]))))
    return {"slots": [{"startsAt": iso(x.starts_at), "endsAt": iso(x.ends_at),
        "available": not any(b.details.get("startsAt", "") < iso(x.ends_at)
            and b.details.get("endsAt", "") > iso(x.starts_at) for b in bookings)}
        for x in slots]}