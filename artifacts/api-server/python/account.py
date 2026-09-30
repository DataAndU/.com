from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from common import FOUNDING_PROVIDER_LIMIT, provider_json, user_json
import referrals
from deps import current_user, get_db, require_role
from models import Listing, Review, User

router = APIRouter()


class RoleBody(BaseModel):
    role: Literal["buyer", "provider"]


class ProfileBody(BaseModel):
    displayName: str | None = Field(None, min_length=1, max_length=120)
    phone: str | None = Field(None, max_length=40)
    contactEmailVisible: bool | None = None
    contactPhoneVisible: bool | None = None


@router.get("/me")
def me(user=Depends(current_user)):
    return user_json(user)


@router.put("/me/role")
def set_role(body: RoleBody, db: Session = Depends(get_db), user=Depends(current_user)):
    locked = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked.role is not None:
        if locked.role == body.role:
            return user_json(locked)
        raise HTTPException(409, "Marketplace role is permanent")
    if body.role == "provider":
        # Count before assigning the role so this user is not counted yet.
        providers = db.scalar(select(func.count()).select_from(User).where(User.role == "provider"))
        locked.founding_provider = providers < FOUNDING_PROVIDER_LIMIT
        referrals.credit_referrer(db, locked)
    locked.role = body.role
    db.flush()
    return user_json(locked)


class AvailabilityBody(BaseModel):
    available: bool
    hours: int = Field(4, ge=1, le=12)


@router.put("/me/availability")
def set_availability(body: AvailabilityBody, db: Session = Depends(get_db),
                     user=Depends(require_role("provider"))):
    """Provider "Available now" switch. Turns itself off after `hours`."""
    user.available_until = (datetime.now(timezone.utc) + timedelta(hours=body.hours)
                            if body.available else None)
    db.flush()
    return user_json(user)


@router.patch("/me")
def update_me(body: ProfileBody, db: Session = Depends(get_db), user=Depends(current_user)):
    values = body.model_dump(exclude_unset=True)
    mapping = {"displayName": "display_name", "contactEmailVisible": "contact_email_visible",
               "contactPhoneVisible": "contact_phone_visible", "phone": "phone"}
    for key, value in values.items():
        setattr(user, mapping[key], value)
    db.flush()
    return user_json(user)


@router.get("/providers/{provider_id}")
def provider(provider_id: str, db: Session = Depends(get_db), viewer=Depends(current_user)):
    target = db.get(User, provider_id)
    if not target or target.role != "provider":
        raise HTTPException(404, "Provider not found")
    listings = db.scalars(select(Listing).where(
        Listing.provider_id == provider_id, Listing.status == "active")
        .order_by(Listing.created_at.desc(), Listing.id))
    from common import listings_json, iso, media_url
    reviews = list(db.scalars(select(Review).where(Review.subject_id == provider_id)
                              .order_by(Review.created_at.desc())))
    # Batched: one provider query + one photo query regardless of listing count.
    return {"provider": provider_json(target),
            "listings": listings_json(db, ((x, None) for x in listings)),
            "reviews": [dict(id=x.id, bookingId=x.booking_id, authorId=x.author_id,
                             subjectId=x.subject_id, rating=x.rating, comment=x.comment,
                             photoUrls=[media_url(m) for m in (x.photo_ids or [])],
                             createdAt=iso(x.created_at)) for x in reviews]}