"""Seasonal / festival banner on the home map, managed by admins."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from common import iso
from deps import current_user, get_db, require_admin
from models import AuditRecord, SiteBanner

router = APIRouter()


class BannerBody(BaseModel):
    message: str = Field(min_length=3, max_length=200)
    linkPath: str | None = Field(None, max_length=200)
    startsAt: datetime
    endsAt: datetime
    active: bool = True

    @model_validator(mode="after")
    def valid(self):
        if self.startsAt.tzinfo is None or self.endsAt.tzinfo is None:
            raise ValueError("Dates must include a timezone")
        if self.endsAt <= self.startsAt:
            raise ValueError("End must be after start")
        # Internal links only: no off-site redirects from the home page.
        if self.linkPath and (not self.linkPath.startswith("/") or self.linkPath.startswith("//")
                              or "\\" in self.linkPath):
            raise ValueError("Link must be a Pontreol page path such as /categories/spaces")
        return self


def banner_json(b):
    return dict(id=b.id, message=b.message, linkPath=b.link_path, startsAt=iso(b.starts_at),
                endsAt=iso(b.ends_at), active=b.active)


@router.get("/banner")
def current_banner(db: Session = Depends(get_db), user=Depends(current_user)):
    now = datetime.now(timezone.utc)
    banner = db.scalar(select(SiteBanner).where(
        SiteBanner.active.is_(True), SiteBanner.starts_at <= now, SiteBanner.ends_at > now).order_by(
        SiteBanner.starts_at.desc()).limit(1))
    return {"banner": banner_json(banner) if banner else None}


@router.get("/admin/banners")
def list_banners(db: Session = Depends(get_db), admin=Depends(require_admin)):
    rows = db.scalars(select(SiteBanner).order_by(SiteBanner.starts_at.desc()).limit(50))
    return {"items": [banner_json(b) for b in rows]}


def _save(db, admin, banner, body, action):
    banner.message, banner.link_path = body.message.strip(), body.linkPath
    banner.starts_at, banner.ends_at, banner.active = body.startsAt, body.endsAt, body.active
    db.add(banner)
    db.flush()
    db.add(AuditRecord(admin_user_id=admin.id, action=action, target_type="banner",
                       target_id=banner.id, metadata_json={"active": body.active}))
    return banner_json(banner)


@router.post("/admin/banners", status_code=201)
def create_banner(body: BannerBody, db: Session = Depends(get_db), admin=Depends(require_admin)):
    return _save(db, admin, SiteBanner(), body, "banner.create")


@router.put("/admin/banners/{banner_id}")
def update_banner(banner_id: str, body: BannerBody, db: Session = Depends(get_db),
                  admin=Depends(require_admin)):
    banner = db.get(SiteBanner, banner_id)
    if not banner:
        raise HTTPException(404, "Banner not found")
    return _save(db, admin, banner, body, "banner.update")
