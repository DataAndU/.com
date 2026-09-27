from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from common import provider_json, user_json
from deps import current_user, get_db
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
    locked.role = body.role
    db.flush()
    return user_json(locked)


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
    listings = list(db.scalars(select(Listing).where(
        Listing.provider_id == provider_id, Listing.status == "active")))
    from common import listing_json, iso
    reviews = list(db.scalars(select(Review).where(Review.subject_id == provider_id)))
    return {"provider": provider_json(target), "listings": [listing_json(db, x) for x in listings],
            "reviews": [dict(id=x.id, bookingId=x.booking_id, authorId=x.author_id,
                             subjectId=x.subject_id, rating=x.rating, comment=x.comment,
                             createdAt=iso(x.created_at)) for x in reviews]}