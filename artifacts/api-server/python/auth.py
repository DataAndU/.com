"""Email one-time-code (OTP) sign-in and opaque server-side sessions.

Flow:
  POST /api/auth/otp/request  {email}           -> emails a 6-digit code (generic response)
  POST /api/auth/otp/verify   {email, code, next} -> new session cookie, {next}
  POST /api/auth/logout                         -> revoke session, clear cookie

Codes come from `secrets`, are stored only as salted scrypt hashes, expire after
10 minutes, are single use, allow 5 attempts, and are rate limited per email and
per client IP. Codes never appear in URLs, logs or the notification outbox.
The account is created or linked only after a successful verification.
Roles, admin status and suspension stay in PostgreSQL and are checked on every
request by deps.current_user.
"""
import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import outbox
from deps import _same_origin_mutation, get_db
from models import AuthRateEvent, AuthSession, EmailOtpChallenge, User

router = APIRouter()
logger = logging.getLogger("pontreol.auth")

SESSION_TTL = timedelta(days=30)
OTP_TTL = timedelta(minutes=10)
OTP_LENGTH = 6
OTP_MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
EMAIL_HOURLY_LIMIT = 5        # codes sent to one address per hour
IP_HOURLY_REQUEST_LIMIT = 20  # codes requested from one client IP per hour
IP_HOURLY_FAILURE_LIMIT = 30  # wrong codes submitted from one client IP per hour
RETENTION = timedelta(days=1)
DEFAULT_NEXT = "/home"
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


# --- helpers -----------------------------------------------------------------

def production():
    return os.getenv("NODE_ENV") == "production"


def session_cookie_name():
    # __Host- prefix: Secure, Path=/, no Domain -> cannot be set by subdomains.
    return "__Host-pontreol_session" if production() else "pontreol_session"


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def utcnow():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def normalize_email(value):
    """Login identity: trimmed, lower-cased address (no provider-specific rewriting)."""
    email = (value or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(422, "invalid_email")
    return email


def client_ip_hash(request: Request):
    """First X-Forwarded-For hop (set by App Platform/nginx), else the socket peer.
    Stored hashed only."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    ip = forwarded or (request.client.host if request.client else "unknown")
    return hashlib.sha256(("pontreol-ip:" + ip).encode()).hexdigest()


def hash_code(code, salt):
    digest = hashlib.scrypt(code.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
    return digest.hex()


def new_code():
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def safe_next(value):
    """Only same-site relative paths: blocks open redirects (//evil, /\\evil, schemes)."""
    if (not value or not value.startswith("/") or value.startswith("//")
            or "\\" in value or any(ord(c) < 32 for c in value) or len(value) > 512):
        return DEFAULT_NEXT
    if value.startswith("/api/") or value.startswith("/sign-in") or value.startswith("/sign-up"):
        return DEFAULT_NEXT
    return value


def set_cookie(response, name, value, max_age, path="/"):
    response.set_cookie(name, value, max_age=max_age, path=path, httponly=True,
                        secure=production(), samesite="lax")


def clear_cookie(response, name, path="/"):
    response.delete_cookie(name, path=path, httponly=True, secure=production(), samesite="lax")


def create_session(db, user_id):
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=token_hash(token), user_id=user_id,
                       expires_at=utcnow() + SESSION_TTL))
    return token


def revoke_presented_session(db, request):
    token = request.cookies.get(session_cookie_name())
    if token:
        db.execute(update(AuthSession).where(
            AuthSession.token_hash == token_hash(token),
            AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))


def too_many(retry_after_seconds):
    return HTTPException(429, "rate_limited",
                         headers={"Retry-After": str(max(1, int(retry_after_seconds)))})


def otp_email(code):
    minutes = int(OTP_TTL.total_seconds() // 60)
    subject = f"Your Pontreol verification code is {code}"
    text = (f"Your Pontreol verification code is {code}\n\n"
            f"It expires in {minutes} minutes and can be used once.\n\n"
            "If you didn't try to sign in to Pontreol, you can safely ignore this email; "
            "nobody can sign in without this code.\n\n— Pontreol")
    return subject, text


# --- routes -------------------------------------------------------------------

class OtpRequestBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class OtpVerifyBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(min_length=1, max_length=12)
    next: str | None = Field(None, max_length=512)


@router.post("/auth/otp/request")
def request_code(body: OtpRequestBody, request: Request, db: Session = Depends(get_db)):
    """Always the same response whether or not an account exists."""
    _same_origin_mutation(request)
    email = normalize_email(body.email)
    sender = os.getenv("RESEND_FROM", "").strip()
    if not sender or not os.getenv("RESEND_API_KEY", "").strip():
        raise HTTPException(503, "email_unavailable")
    now = utcnow()
    ip = client_ip_hash(request)
    db.execute(delete(EmailOtpChallenge).where(EmailOtpChallenge.created_at < now - RETENTION))
    db.execute(delete(AuthRateEvent).where(AuthRateEvent.created_at < now - RETENTION))

    hour_ago = now - timedelta(hours=1)
    latest = db.scalar(select(func.max(EmailOtpChallenge.created_at)).where(
        EmailOtpChallenge.email == email))
    if latest is not None and aware(latest) > now - RESEND_COOLDOWN:
        raise too_many((aware(latest) + RESEND_COOLDOWN - now).total_seconds())
    sent_to_email = db.scalar(select(func.count()).select_from(EmailOtpChallenge).where(
        EmailOtpChallenge.email == email, EmailOtpChallenge.created_at > hour_ago))
    sent_from_ip = db.scalar(select(func.count()).select_from(EmailOtpChallenge).where(
        EmailOtpChallenge.ip_hash == ip, EmailOtpChallenge.created_at > hour_ago))
    if sent_to_email >= EMAIL_HOURLY_LIMIT or sent_from_ip >= IP_HOURLY_REQUEST_LIMIT:
        raise too_many(3600)

    # Only the newest code for an address is ever valid.
    db.execute(update(EmailOtpChallenge).where(
        EmailOtpChallenge.email == email, EmailOtpChallenge.consumed_at.is_(None)).values(
        consumed_at=now))
    code = new_code()
    salt = secrets.token_hex(16)
    challenge = EmailOtpChallenge(email=email, code_salt=salt, code_hash=hash_code(code, salt),
                                  ip_hash=ip, created_at=now, expires_at=now + OTP_TTL)
    db.add(challenge)
    db.flush()
    subject, text = otp_email(code)
    try:
        # Sent directly (never via the outbox table, which would store the code).
        outbox.send_via_resend({"from": sender, "to": email, "subject": subject, "text": text,
                                "idempotencyKey": f"otp-{challenge.id}"})
    except outbox.EmailError as exc:
        db.rollback()
        logger.warning("Sign-in code email failed: %s", exc)  # EmailError text is secret-free
        raise HTTPException(503, "email_send_failed") from exc
    except Exception as exc:  # never leak transport details
        db.rollback()
        logger.warning("Sign-in code email failed: %s", type(exc).__name__)
        raise HTTPException(503, "email_send_failed") from exc
    return {"sent": True, "expiresIn": int(OTP_TTL.total_seconds()),
            "resendAfter": int(RESEND_COOLDOWN.total_seconds())}


def find_or_create_user(db, email):
    """Existing account by normalized email, else a new one. Never merges."""
    if db.get_bind().dialect.name == "postgresql":
        # Serialize first sign-ins per address (email has no unique constraint
        # because legacy duplicates may exist); released at transaction end.
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                   {"k": "pontreol-signin:" + email})
    matches = list(db.scalars(select(User).where(func.lower(User.email) == email).with_for_update()))
    if len(matches) > 1:
        logger.warning("Sign-in refused: %d accounts share one email; needs operator review",
                       len(matches))
        raise HTTPException(409, "account_conflict")
    if matches:
        return matches[0], "existing"
    user = User(email=email, display_name=email.split("@")[0][:120])
    db.add(user)
    db.flush()
    return user, "created"


def record_failure(db, ip):
    db.add(AuthRateEvent(ip_hash=ip, kind="otp_failed"))


@router.post("/auth/otp/verify")
def verify_code(body: OtpVerifyBody, request: Request, db: Session = Depends(get_db)):
    _same_origin_mutation(request)
    email = normalize_email(body.email)
    ip = client_ip_hash(request)
    now = utcnow()
    failures = db.scalar(select(func.count()).select_from(AuthRateEvent).where(
        AuthRateEvent.ip_hash == ip, AuthRateEvent.created_at > now - timedelta(hours=1)))
    if failures >= IP_HOURLY_FAILURE_LIMIT:
        raise too_many(3600)

    challenge = db.scalar(select(EmailOtpChallenge).where(
        EmailOtpChallenge.email == email, EmailOtpChallenge.consumed_at.is_(None)).order_by(
        EmailOtpChallenge.created_at.desc()).limit(1).with_for_update())
    if challenge is None:
        record_failure(db, ip)
        db.commit()
        raise HTTPException(400, "invalid_code")
    if aware(challenge.expires_at) <= now:
        challenge.consumed_at = now
        db.commit()
        raise HTTPException(400, "expired_code")

    code = re.sub(r"\s", "", body.code)
    matches = (len(code) == OTP_LENGTH and code.isdigit()
               and secrets.compare_digest(hash_code(code, challenge.code_salt), challenge.code_hash))
    if not matches:
        challenge.attempts += 1
        if challenge.attempts >= OTP_MAX_ATTEMPTS:
            challenge.consumed_at = now
        record_failure(db, ip)
        db.commit()
        raise HTTPException(400, "too_many_attempts" if challenge.consumed_at else "invalid_code")

    # Single use: consumed before anything else can happen (replay protection).
    challenge.consumed_at = now
    db.commit()
    try:
        user, outcome = find_or_create_user(db, email)
    except IntegrityError:
        db.rollback()  # concurrent first sign-in for the same address
        user, outcome = find_or_create_user(db, email)
    if user.suspended:
        db.commit()
        raise HTTPException(403, "suspended")
    # Session rotation / fixation defence: always a brand-new token.
    revoke_presented_session(db, request)
    token = create_session(db, user.id)
    db.commit()
    logger.info("Email sign-in ok outcome=%s", outcome)
    destination = safe_next(body.next) if user.role else "/onboarding"
    response = JSONResponse({"next": destination})
    response.headers["Cache-Control"] = "no-store"
    set_cookie(response, session_cookie_name(), token, int(SESSION_TTL.total_seconds()))
    return response


@router.post("/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    _same_origin_mutation(request)
    revoke_presented_session(db, request)
    response = JSONResponse({"signedOut": True})
    clear_cookie(response, session_cookie_name())
    return response
