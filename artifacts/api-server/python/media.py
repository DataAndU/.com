import os
from datetime import timedelta
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from google.cloud import storage
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from common import media_json
from deps import current_user, get_db
from models import Media, uid

router = APIRouter()
TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def bucket():
    bucket_id = os.getenv("DEFAULT_OBJECT_STORAGE_BUCKET_ID")
    private_dir = os.getenv("PRIVATE_OBJECT_DIR", "").strip("/")
    if not bucket_id or not private_dir:
        raise HTTPException(503, "Durable cloud storage is not configured")
    try:
        return storage.Client().bucket(bucket_id), private_dir
    except Exception as exc:
        raise HTTPException(503, "Durable cloud storage is unavailable") from exc


class UploadBody(BaseModel):
    purpose: str
    fileName: str = Field(min_length=1, max_length=255)
    contentType: str
    sizeBytes: int = Field(gt=0)


@router.post("/media/uploads")
def request_upload(body: UploadBody, db: Session = Depends(get_db), user=Depends(current_user)):
    if body.purpose not in {"listingPhoto", "verificationId"} or body.contentType not in TYPES:
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


@router.get("/media/{media_id}")
def serve(media_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    media = db.get(Media, media_id)
    if not media or media.status != "ready":
        raise HTTPException(404, "Media not found")
    if media.is_private and media.owner_id != user.id and not user.is_admin:
        raise HTTPException(404, "Media not found")
    cloud, _ = bucket()
    try:
        url = cloud.blob(media.object_path).generate_signed_url(version="v4",
            expiration=timedelta(minutes=5), method="GET")
    except Exception as exc:
        raise HTTPException(503, "Cloud media is temporarily unavailable") from exc
    return RedirectResponse(url)