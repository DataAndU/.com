"""Native Google sign-in (OpenID Connect authorization-code flow + PKCE) and
opaque server-side sessions.

Flow:
  GET  /api/auth/google/start     -> 302 to Google (state, nonce, PKCE S256)
  GET  /api/auth/google/callback  -> verify, find/link/create user, new session
  POST /api/auth/logout           -> revoke session, clear cookie

The browser only ever holds random opaque cookies (HttpOnly). Google tokens are
never sent to or stored in the browser. Roles, admin status and suspension stay
in PostgreSQL and are checked on every request by deps.current_user.
"""
import base64
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from deps import _same_origin_mutation, get_db
from models import AuthSession, OAuthLoginAttempt, User

router = APIRouter()
logger = logging.getLogger("pontreol.auth")

GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SESSION_TTL = timedelta(days=30)
LOGIN_ATTEMPT_TTL = timedelta(minutes=10)
CALLBACK_PATH = "/api/auth/google/callback"
DEFAULT_NEXT = "/home"


# --- configuration ---------------------------------------------------------

def production():
    return os.getenv("NODE_ENV") == "production"


def session_cookie_name():
    # __Host- prefix: Secure, Path=/, no Domain -> cannot be set by subdomains.
    return "__Host-pontreol_session" if production() else "pontreol_session"


def login_cookie_name():
    return "__Host-pontreol_login" if production() else "pontreol_login"


def google_client():
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise HTTPException(503, "Google sign-in is not configured")
    return client_id, client_secret


def redirect_uri():
    """Exact callback registered in Google Cloud. Never derived from the
    request Host header."""
    explicit = os.getenv("GOOGLE_REDIRECT_URI", "").strip()
    if explicit:
        return explicit
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(","):
        parsed = urlparse(origin.strip())
        if parsed.scheme in {"http", "https"} and parsed.hostname:
            return f"{parsed.scheme}://{parsed.netloc}{CALLBACK_PATH}"
    raise HTTPException(503, "Google sign-in redirect URI is not configured")


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def utcnow():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


# --- Google OIDC discovery / JWKS -------------------------------------------

_discovery = {"at": 0.0, "doc": None}
_jwks_clients = {}


def discovery():
    if _discovery["doc"] and time.monotonic() - _discovery["at"] < 3600:
        return _discovery["doc"]
    try:
        response = httpx.get(GOOGLE_DISCOVERY_URL, timeout=8)
        response.raise_for_status()
        doc = response.json()
        for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
            if not str(doc.get(key, "")).startswith("https://"):
                raise ValueError(key)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Google OIDC discovery unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Google sign-in is temporarily unavailable") from exc
    _discovery.update(at=time.monotonic(), doc=doc)
    return doc


def jwks_client(uri):
    if uri not in _jwks_clients:
        _jwks_clients[uri] = jwt.PyJWKClient(uri, cache_keys=True, lifespan=3600)
    return _jwks_clients[uri]


class IdentityError(Exception):
    """Rejected Google identity (never shown verbatim to users)."""


def verify_id_token(id_token, client_id, nonce, jwks):
    """Validate signature, issuer, audience, expiry, nonce and verified email."""
    try:
        key = jwks.get_signing_key_from_jwt(id_token)
        claims = jwt.decode(id_token, key.key, algorithms=["RS256"], audience=client_id,
                            issuer=list(GOOGLE_ISSUERS), leeway=30,
                            options={"require": ["exp", "iat", "iss", "aud", "sub"]})
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(503, "Google sign-in is temporarily unavailable") from exc
    except jwt.PyJWTError as exc:
        raise IdentityError(f"invalid id_token: {type(exc).__name__}") from exc
    if not isinstance(claims.get("nonce"), str) or not secrets.compare_digest(claims["nonce"], nonce):
        raise IdentityError("nonce mismatch")
    if claims.get("azp") and claims["azp"] != client_id:
        raise IdentityError("authorized party mismatch")
    if claims.get("email_verified") is not True or not claims.get("email"):
        raise IdentityError("email not verified")
    return claims


# --- helpers ----------------------------------------------------------------

def safe_next(value):
    """Only same-site relative paths: blocks open redirects (//evil, /\\evil, schemes)."""
    if (not value or not value.startswith("/") or value.startswith("//")
            or "\\" in value or any(ord(c) < 32 for c in value) or len(value) > 512):
        return DEFAULT_NEXT
    if value.startswith("/api/") or value.startswith("/sign-in"):
        return DEFAULT_NEXT
    return value


def set_cookie(response, name, value, max_age, path="/"):
    response.set_cookie(name, value, max_age=max_age, path=path, httponly=True,
                        secure=production(), samesite="lax")


def clear_cookie(response, name, path="/"):
    response.delete_cookie(name, path=path, httponly=True, secure=production(), samesite="lax")


def sign_in_error(code):
    response = RedirectResponse(f"/sign-in?error={code}", status_code=302)
    clear_cookie(response, login_cookie_name())
    return response


def find_or_link_user(db, claims):
    """google_sub first; else link a legacy (Clerk-era) account by verified
    email, only when exactly one unlinked account matches; else create."""
    sub = claims["sub"]
    email = claims["email"].strip()
    user = db.scalar(select(User).where(User.google_sub == sub).with_for_update())
    if user:
        return user, "existing"
    matches = list(db.scalars(select(User).where(
        func.lower(User.email) == email.lower()).with_for_update()))
    if len(matches) > 1:
        raise IdentityError("multiple accounts share this email")
    if matches:
        match = matches[0]
        if match.google_sub and match.google_sub != sub:
            # The email now belongs to a different Google account: never merge.
            raise IdentityError("email linked to a different Google account")
        match.google_sub = sub
        return match, "linked"
    user = User(google_sub=sub, email=email,
                display_name=(claims.get("name") or email.split("@")[0])[:120],
                avatar_url=claims.get("picture"))
    db.add(user)
    db.flush()
    return user, "created"


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


# --- routes -----------------------------------------------------------------

@router.get("/auth/google/start")
def google_start(request: Request, next: str = DEFAULT_NEXT, db: Session = Depends(get_db)):
    client_id, _ = google_client()
    endpoint = discovery()["authorization_endpoint"]
    browser = secrets.token_urlsafe(32)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    db.execute(delete(OAuthLoginAttempt).where(
        OAuthLoginAttempt.created_at < utcnow() - LOGIN_ATTEMPT_TTL))
    db.add(OAuthLoginAttempt(browser_hash=token_hash(browser), state=state, nonce=nonce,
                             code_verifier=verifier, next_path=safe_next(next)))
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri(),
              "scope": "openid email profile", "state": state, "nonce": nonce,
              "code_challenge": challenge, "code_challenge_method": "S256",
              "prompt": "select_account"}
    response = RedirectResponse(f"{endpoint}?{urlencode(params)}", status_code=302)
    response.headers["Cache-Control"] = "no-store"
    set_cookie(response, login_cookie_name(), browser, int(LOGIN_ATTEMPT_TTL.total_seconds()))
    return response


def exchange_code(code, verifier, client_id, client_secret):
    try:
        response = httpx.post(discovery()["token_endpoint"], timeout=10, data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(),
            "client_id": client_id, "client_secret": client_secret, "code_verifier": verifier})
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Google sign-in is temporarily unavailable") from exc
    if response.status_code != 200:
        raise IdentityError(f"token exchange rejected ({response.status_code})")
    id_token = response.json().get("id_token")
    if not id_token:
        raise IdentityError("no id_token")
    return id_token


@router.get("/auth/google/callback")
def google_callback(request: Request, code: str | None = None, state: str | None = None,
                    error: str | None = None, db: Session = Depends(get_db)):
    browser = request.cookies.get(login_cookie_name())
    if not browser:
        return sign_in_error("expired")
    # Single use: the attempt is consumed whatever happens next (replay protection).
    attempt = db.scalar(select(OAuthLoginAttempt).where(
        OAuthLoginAttempt.browser_hash == token_hash(browser)).with_for_update())
    if attempt is not None:
        db.delete(attempt)
    # Commit consumption now so a later failure/rollback cannot resurrect it.
    db.commit()
    if attempt is None or aware(attempt.created_at) < utcnow() - LOGIN_ATTEMPT_TTL:
        db.commit()
        return sign_in_error("expired")
    if error:
        db.commit()
        return sign_in_error("cancelled")
    if not code or not state or not secrets.compare_digest(state, attempt.state):
        db.commit()
        logger.warning("Google sign-in rejected: state mismatch")
        return sign_in_error("failed")
    client_id, client_secret = google_client()
    try:
        id_token = exchange_code(code, attempt.code_verifier, client_id, client_secret)
        claims = verify_id_token(id_token, client_id, attempt.nonce,
                                 jwks_client(discovery()["jwks_uri"]))
        try:
            user, outcome = find_or_link_user(db, claims)
            db.flush()
        except IntegrityError:
            # Concurrent first sign-in for the same Google account.
            db.rollback()
            user, outcome = find_or_link_user(db, claims)
    except IdentityError as exc:
        db.rollback()
        logger.warning("Google sign-in rejected: %s", exc)
        return sign_in_error("failed")
    if user.suspended:
        db.commit()
        return sign_in_error("suspended")
    # Session fixation defence: always a brand-new token; revoke any presented one.
    revoke_presented_session(db, request)
    token = create_session(db, user.id)
    db.commit()
    logger.info("Google sign-in ok outcome=%s", outcome)
    destination = attempt.next_path if user.role else "/onboarding"
    response = RedirectResponse(safe_next(destination), status_code=302)
    response.headers["Cache-Control"] = "no-store"
    clear_cookie(response, login_cookie_name())
    set_cookie(response, session_cookie_name(), token, int(SESSION_TTL.total_seconds()))
    return response


@router.post("/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    _same_origin_mutation(request)
    revoke_presented_session(db, request)
    response = JSONResponse({"signedOut": True})
    clear_cookie(response, session_cookie_name())
    return response
