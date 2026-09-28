"""Refer-a-provider: personal invite codes and free-month credits.

A new account created through someone's invite link records `referred_by`.
When that account chooses the provider role (a permanent, one-time choice),
the inviter earns one free-month credit. Credits are recorded, not applied to
live Razorpay billing automatically; an admin applies them.
"""
import secrets

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from deps import current_user, get_db, require_admin
from models import User

router = APIRouter()
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion
CODE_LENGTH = 8


def normalize(code):
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())[:16]


def find_referrer(db, code):
    code = normalize(code)
    if len(code) != CODE_LENGTH:
        return None
    return db.scalar(select(User).where(User.referral_code == code))


def ensure_code(db, user):
    if user.referral_code:
        return user.referral_code
    for _ in range(10):
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        if not db.scalar(select(User.id).where(User.referral_code == code)):
            user.referral_code = code
            db.flush()
            return code
    raise RuntimeError("could not allocate a referral code")


def credit_referrer(db, new_provider):
    """Called once, when a referred account picks the provider role."""
    if not new_provider.referred_by or new_provider.role is not None:
        return
    referrer = db.scalar(select(User).where(User.id == new_provider.referred_by).with_for_update())
    if referrer is not None and referrer.id != new_provider.id:
        referrer.referral_credit_months = (referrer.referral_credit_months or 0) + 1


@router.get("/me/referral")
def my_referral(db: Session = Depends(get_db), user=Depends(current_user)):
    code = ensure_code(db, user)
    invited = db.scalar(select(func.count()).select_from(User).where(User.referred_by == user.id))
    providers = db.scalar(select(func.count()).select_from(User).where(
        User.referred_by == user.id, User.role == "provider"))
    return {"code": code, "path": f"/sign-up?ref={code}", "invited": invited,
            "providers": providers, "creditMonths": user.referral_credit_months or 0}


@router.get("/admin/referrals")
def admin_referrals(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db),
                    admin=Depends(require_admin)):
    rows = db.scalars(select(User).where(User.referral_credit_months > 0).order_by(
        User.referral_credit_months.desc(), User.id).limit(limit))
    return {"items": [dict(id=u.id, email=u.email, displayName=u.display_name,
                           creditMonths=u.referral_credit_months) for u in rows]}
