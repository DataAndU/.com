"""Society / apartment pages: residents recommend helpers they have actually
used (a completed booking is required). Pages show providers and how many
residents vouch for them, never who the residents are."""
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from common import provider_json
from deps import current_user, get_db
from models import Booking, SocietyRecommendation, User

router = APIRouter()


def slugify(name):
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:80]


class RecommendBody(BaseModel):
    societyName: str = Field(min_length=3, max_length=120)
    providerId: str


@router.post("/societies/recommend", status_code=201)
def recommend(body: RecommendBody, db: Session = Depends(get_db), user=Depends(current_user)):
    slug = slugify(body.societyName)
    if len(slug) < 3:
        raise HTTPException(422, "Use a society name with letters or numbers")
    used = db.scalar(select(Booking.id).where(
        Booking.buyer_id == user.id, Booking.provider_id == body.providerId,
        Booking.status == "completed").limit(1))
    if not used:
        raise HTTPException(403, "You can only recommend helpers you have booked and completed a job with")
    if db.scalar(select(SocietyRecommendation.id).where(
            SocietyRecommendation.society_slug == slug, SocietyRecommendation.user_id == user.id,
            SocietyRecommendation.provider_id == body.providerId)):
        return {"slug": slug, "created": False}
    try:
        with db.begin_nested():
            db.add(SocietyRecommendation(society_slug=slug, society_name=body.societyName.strip(),
                                         user_id=user.id, provider_id=body.providerId))
    except IntegrityError:
        return {"slug": slug, "created": False}
    return {"slug": slug, "created": True}


@router.delete("/societies/{slug}/recommend/{provider_id}", status_code=204)
def withdraw(slug: str, provider_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    db.query(SocietyRecommendation).filter(
        SocietyRecommendation.society_slug == slug, SocietyRecommendation.user_id == user.id,
        SocietyRecommendation.provider_id == provider_id).delete()


@router.get("/societies/{slug}")
def society(slug: str, db: Session = Depends(get_db), user=Depends(current_user)):
    rows = db.execute(select(SocietyRecommendation.provider_id, func.count(SocietyRecommendation.id))
                      .where(SocietyRecommendation.society_slug == slug)
                      .group_by(SocietyRecommendation.provider_id)).all()
    name = db.scalar(select(SocietyRecommendation.society_name).where(
        SocietyRecommendation.society_slug == slug).limit(1))
    counts = dict(rows)
    providers = list(db.scalars(select(User).where(User.id.in_(counts), User.suspended.is_(False))))
    mine = set(db.scalars(select(SocietyRecommendation.provider_id).where(
        SocietyRecommendation.society_slug == slug, SocietyRecommendation.user_id == user.id)))
    helpers = sorted(({"provider": provider_json(p), "recommendations": counts[p.id],
                       "recommendedByMe": p.id in mine} for p in providers),
                     key=lambda x: (-x["recommendations"], x["provider"]["displayName"] or ""))
    return {"slug": slug, "name": name, "helpers": helpers}


@router.get("/me/used-providers")
def used_providers(db: Session = Depends(get_db), user=Depends(current_user)):
    """Helpers this user completed jobs with: the ones they may recommend."""
    ids = set(db.scalars(select(Booking.provider_id).where(
        Booking.buyer_id == user.id, Booking.status == "completed")))
    return {"items": [provider_json(p) for p in db.scalars(select(User).where(User.id.in_(ids)))]}
