import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import spaces
from common import media_json
from deps import current_user, get_db
from models import Media, uid

router = APIRouter()
TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


_storage = None


def _bucket_client():
    # Reuse one thread-safe client per process (connection pooling).
    global _storage
    if _storage is None:
        _, _, bucket_name, _, _ = spaces.settings()
        _storage = spaces.SpacesBucket(spaces.make_client(), bucket_name)
    return _storage


def bucket():
    private_dir = os.getenv("PRIVATE_OBJECT_DIR", "").strip("/")
    if not private_dir:
        raise HTTPException(503, "Durable cloud storage is not configured")
    try:
        return _bucket_client(), private_dir
    except spaces.StorageNotConfigured as exc:
        # Names missing variables only; never values.
        logging.getLogger("pontreol.storage").warning("Photo storage not configured: %s", exc)
        raise HTTPException(503, "Durable cloud storage is not configured") from exc
    except Exception as exc:
        logging.getLogger("pontreol.storage").warning("Photo storage unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Durable cloud storage is unavailable") from exc


class UploadBody(BaseModel):
    purpose: str
    fileName: str = Field(min_length=1, max_length=255)
    contentType: str
    sizeBytes: int = Field(gt=0)


@router.post("/media/uploads")
def request_upload(body: UploadBody, db: Session = Depends(get_db), user=Depends(current_user)):
    if body.purpose not in {"listingPhoto", "verificationId", "reviewPhoto"} or body.contentType not in TYPES:
        raise HTTPException(422, "Unsupported upload purpose or image type")
    maximum = 200 * 1024 if body.purpose == "verificationId" else 2 * 1024 * 1024
    if body.sizeBytes > maximum:
        raise HTTPException(413, f"Image exceeds the {maximum}-byte limit")
    cloud, private_dir = bucket()
    media_id = uid()
    object_name = f"{private_dir}/{user.id}/{body.purpose}/{media_id}{TYPES[body.contentType]}"
    blob = cloud.blob(object_name)
    try:
        url = blob.generate_signed_url(version="v4", expiration=timedelta(minutes=15),
                                       method="PUT", content_type=body.contentType)
    except Exception as exc:
        raise HTTPException(503, "Could not create a durable upload URL") from exc
    media = Media(id=media_id, owner_id=user.id, purpose=body.purpose,
                  object_path=object_name, content_type=body.contentType,
                  size_bytes=body.sizeBytes, is_private=body.purpose == "verificationId")
    db.add(media)
    return {"mediaId": media.id, "uploadUrl": url, "objectPath": object_name,
            "requiredHeaders": {"Content-Type": body.contentType}}


@router.post("/media/{media_id}/finalize")
def finalize(media_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    media = db.get(Media, media_id)
    if not media or media.owner_id != user.id:
        raise HTTPException(404, "Media not found")
    cloud, _ = bucket()
    blob = cloud.blob(media.object_path)
    try:
        blob.reload()
    except Exception as exc:
        raise HTTPException(422, "Uploaded cloud object was not found") from exc
    if int(blob.size or -1) != media.size_bytes or blob.content_type != media.content_type:
        try: blob.delete()
        except Exception: pass
        raise HTTPException(422, "Uploaded object metadata does not match the request")
    media.status = "ready"
    return {"media": media_json(media)}


# Signed GET URLs are valid for an hour and reused until 10 minutes remain,
# so repeated image loads do not re-sign. Authorization is still checked on
# every request before a cached URL is returned.
SIGNED_URL_TTL = timedelta(hours=1)
SIGNED_URL_MIN_REMAINING = timedelta(minutes=10)
BROWSER_CACHE_SECONDS = 300
_signed_cache: dict[str, tuple[datetime, str]] = {}
_SIGNED_CACHE_MAX = 5000


def _signed_url(cloud, media):
    now = datetime.now(timezone.utc)
    cached = _signed_cache.get(media.id)
    if cached and cached[0] - now > SIGNED_URL_MIN_REMAINING:
        return cached[1]
    url = cloud.blob(media.object_path).generate_signed_url(
        version="v4", expiration=SIGNED_URL_TTL, method="GET")
    if len(_signed_cache) >= _SIGNED_CACHE_MAX:
        _signed_cache.pop(next(iter(_signed_cache)), None)
    _signed_cache[media.id] = (now + SIGNED_URL_TTL, url)
    return url


@router.get("/media/{media_id}")
def serve(media_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    media = db.get(Media, media_id)
    if not media or media.status != "ready":
        raise HTTPException(404, "Media not found")
    if media.is_private and media.owner_id != user.id and not user.is_admin:
        raise HTTPException(404, "Media not found")
    cloud, _ = bucket()
    try:
        url = _signed_url(cloud, media)
    except Exception as exc:
        raise HTTPException(503, "Cloud media is temporarily unavailable") from exc
    response = RedirectResponse(url, status_code=302)
    # Private: per-user authorization; never stored by shared caches/CDNs.
    response.headers["Cache-Control"] = (
        "private, no-store" if media.is_private else f"private, max-age={BROWSER_CACHE_SECONDS}")
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
