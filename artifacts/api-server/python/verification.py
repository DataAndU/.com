from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from common import iso, listing_json, user_json
from deps import current_user, get_db, require_admin
from models import AuditRecord, Listing, Media, User, Verification
from pagination import keyset_page

router = APIRouter()


def verification_json(item):
    return dict(id=item.id, userId=item.user_id, legalName=item.legal_name,
                idType=item.id_type, idMediaId=item.id_media_id, status=item.status,
                rejectionReason=item.rejection_reason, submittedAt=iso(item.submitted_at),
                reviewedAt=iso(item.reviewed_at), reviewedBy=item.reviewed_by)


@router.get("/verification")
def get_verification(db: Session = Depends(get_db), user=Depends(current_user)):
    item = db.scalar(select(Verification).where(Verification.user_id == user.id))
    if not item:
        return {"status": "notStarted", "submittedAt": None,
                "reviewedAt": None, "rejectionReason": None}
    result = verification_json(item)
    # Never expose even a private media identifier from this summary.
    result.pop("idMediaId")
    return result


class VerificationBody(BaseModel):
    legalName: str = Field(min_length=2, max_length=160)
    idType: str = Field(min_length=2, max_length=40)
    idMediaId: str


@router.post("/verification", status_code=201)
def submit(body: VerificationBody, db: Session = Depends(get_db), user=Depends(current_user)):
    media = db.get(Media, body.idMediaId)
    if (not media or media.owner_id != user.id or media.purpose != "verificationId"
            or media.status != "ready" or media.size_bytes > 200 * 1024):
        raise HTTPException(422, "A finalized private ID image of at most 200 KiB is required")
    item = db.scalar(select(Verification).where(Verification.user_id == user.id).with_for_update())
    if item and item.status == "pending":
        raise HTTPException(409, "Verification is already pending")
    if item and item.status == "verified":
        raise HTTPException(409, "Account is already verified")
    if not item:
        item = Verification(user_id=user.id, legal_name=body.legalName,
                            id_type=body.idType, id_media_id=body.idMediaId)
        db.add(item)
    else:
        item.legal_name, item.id_type, item.id_media_id = body.legalName, body.idType, body.idMediaId
        item.status, item.rejection_reason = "pending", None
        item.submitted_at, item.reviewed_at, item.reviewed_by = datetime.now(timezone.utc), None, None
    user.verification_status = "pending"
    db.flush()
    return {"status": "pending", "submittedAt": iso(item.submitted_at)}


@router.get("/admin/verifications")
def admin_verifications(status: str | None = None, cursor: str | None = None,
                        limit: int = Query(50, ge=1, le=100),
                        db: Session = Depends(get_db), admin=Depends(require_admin)):
    stmt = select(Verification)
    if status: stmt = stmt.where(Verification.status == status)
    rows, next_cursor = keyset_page(db, stmt, Verification.submitted_at,
                                    Verification.id, limit, cursor)
    return {"items": [verification_json(x) for x in rows], "nextCursor": next_cursor}


class DecisionBody(BaseModel):
    decision: str
    reason: str | None = Field(None, max_length=2000)


@router.post("/admin/verifications/{verification_id}/decision")
def decision(verification_id: str, body: DecisionBody, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if body.decision not in {"verified", "rejected"}:
        raise HTTPException(422, "Decision must be verified or rejected")
    if body.decision == "rejected" and not body.reason:
        raise HTTPException(422, "A rejection reason is required")
    item = db.scalar(select(Verification).where(Verification.id == verification_id).with_for_update())
    if not item or item.status != "pending": raise HTTPException(409, "Verification is not pending")
    item.status, item.rejection_reason = body.decision, body.reason
    item.reviewed_at, item.reviewed_by = datetime.now(timezone.utc), admin.id
    db.get(User, item.user_id).verification_status = body.decision
    db.add(AuditRecord(admin_user_id=admin.id, action="verification.decision",
        target_type="verification", target_id=item.id,
        metadata_json={"decision": body.decision, "reason": body.reason}))
    return {"verification": verification_json(item)}


@router.get("/admin/users")
def admin_users(search: str | None = None, role: str | None = None,
                cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
                db: Session = Depends(get_db), admin=Depends(require_admin)):
    stmt = select(User)
    if search: stmt = stmt.where(User.email.ilike(f"%{search[:100]}%"))
    if role: stmt = stmt.where(User.role == role)
    rows, next_cursor = keyset_page(db, stmt, User.created_at, User.id, limit, cursor)
    return {"items": [user_json(x) for x in rows], "nextCursor": next_cursor}


class SuspendBody(BaseModel):
    suspended: bool
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/admin/users/{user_id}/suspend")
def suspend(user_id: str, body: SuspendBody, db: Session = Depends(get_db), admin=Depends(require_admin)):
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "User not found")
    if target.id == admin.id: raise HTTPException(409, "Administrators cannot suspend themselves")
    target.suspended = body.suspended
    db.add(AuditRecord(admin_user_id=admin.id, action="user.suspend",
        target_type="user", target_id=target.id,
        metadata_json={"suspended": body.suspended, "reason": body.reason}))
    return {"user": user_json(target)}


@router.get("/admin/listings")
def admin_listings(status: str | None = None, cursor: str | None = None,
                   limit: int = Query(50, ge=1, le=100),
                   db: Session = Depends(get_db), admin=Depends(require_admin)):
    stmt = select(Listing)
    if status: stmt = stmt.where(Listing.status == status)
    rows, next_cursor = keyset_page(db, stmt, Listing.created_at, Listing.id, limit, cursor)
    return {"items": [listing_json(db, x) for x in rows], "nextCursor": next_cursor}


class ModerateBody(BaseModel):
    action: str
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/admin/listings/{listing_id}/moderate")
def moderate(listing_id: str, body: ModerateBody, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if body.action not in {"pause", "restore", "delete"}: raise HTTPException(422, "Invalid moderation action")
    item = db.get(Listing, listing_id)
    if not item: raise HTTPException(404, "Listing not found")
    result = None
    if body.action == "delete": db.delete(item)
    else:
        item.status = "paused" if body.action == "pause" else "active"
        result = listing_json(db, item)
    db.add(AuditRecord(admin_user_id=admin.id, action=f"listing.{body.action}",
        target_type="listing", target_id=listing_id, metadata_json={"reason": body.reason}))
    return {"listing": result}


@router.get("/admin/audit")
def audit(cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
          db: Session = Depends(get_db), admin=Depends(require_admin)):
    rows, next_cursor = keyset_page(db, select(AuditRecord), AuditRecord.created_at,
                                    AuditRecord.id, limit, cursor)
    return {"items": [dict(id=x.id, adminUserId=x.admin_user_id, action=x.action,
        targetType=x.target_type, targetId=x.target_id, metadata=x.metadata_json,
        createdAt=iso(x.created_at)) for x in rows], "nextCursor": next_cursor}