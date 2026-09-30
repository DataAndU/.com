"""Notify me when someone is free: a customer who found nobody available
leaves an alert (category, optional keyword, their location). When a provider
switches on "Available now" with a matching listing within 10 km, the customer
gets one notification and the alert is used up. Alerts expire after 7 days."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from deps import get_db, require_role
from listings import CATEGORIES, haversine_km
from models import FreeAlert, Listing, Notification

router = APIRouter()
ALERT_RADIUS_KM = 10
ALERT_TTL = timedelta(days=7)
MAX_ALERTS_PER_USER = 10


class AlertBody(BaseModel):
    category: str | None = None
    keyword: str | None = Field(None, max_length=60)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@router.post("/free-alerts", status_code=201)
def create_alert(body: AlertBody, db: Session = Depends(get_db), user=Depends(require_role("buyer"))):
    if body.category and body.category not in CATEGORIES:
        raise HTTPException(422, "Unknown category")
    now = datetime.now(timezone.utc)
    active = db.scalar(select(func.count(FreeAlert.id)).where(
        FreeAlert.user_id == user.id, FreeAlert.expires_at > now))
    if active >= MAX_ALERTS_PER_USER:
        raise HTTPException(429, "You already have 10 alerts waiting")
    alert = FreeAlert(user_id=user.id, category=body.category,
                      keyword=(body.keyword or "").strip().lower()[:60] or None,
                      latitude=body.latitude, longitude=body.longitude, expires_at=now + ALERT_TTL)
    db.add(alert); db.flush()
    return {"id": alert.id, "expiresAt": alert.expires_at.isoformat()}


def notify_free(db, provider):
    """Called when a provider switches Available now on."""
    now = datetime.now(timezone.utc)
    listings = list(db.scalars(select(Listing).where(
        Listing.provider_id == provider.id, Listing.status == "active",
        Listing.category.in_(CATEGORIES))))
    if not listings:
        return 0
    alerts = list(db.scalars(select(FreeAlert).where(
        FreeAlert.expires_at > now, FreeAlert.user_id != provider.id).with_for_update(skip_locked=True)))
    fired = 0
    for alert in alerts:
        match = next((l for l in listings
                      if (not alert.category or l.category == alert.category)
                      and (not alert.keyword or alert.keyword in f"{l.title} {l.description}".lower())
                      and haversine_km(alert.latitude, alert.longitude, l.latitude, l.longitude) <= ALERT_RADIUS_KM), None)
        if match:
            db.add(Notification(user_id=alert.user_id, type="free_alert",
                                title=f"{provider.display_name} is free now",
                                body=f"{match.title} near you is available right now.",
                                resource_type="listing", resource_id=match.id))
            db.delete(alert)
            fired += 1
    db.flush()
    return fired
