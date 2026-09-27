"""Database and verified Clerk cookie dependencies."""
import base64
import os
from urllib.parse import urlparse

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from models import User

DATABASE_URL = os.getenv("DATABASE_URL", "")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://") and "+psycopg" not in DATABASE_URL:
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]


def _env_int(name, default):
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _engine_options():
    """Bounded, health-checked pool. Each API process keeps at most
    DB_POOL_SIZE + DB_MAX_OVERFLOW connections; size this against the
    database's connection limit multiplied by the number of API instances."""
    return dict(
        pool_pre_ping=True,  # transparently replaces connections dropped by the server/proxy
        pool_size=_env_int("DB_POOL_SIZE", 5),
        max_overflow=_env_int("DB_MAX_OVERFLOW", 5),
        pool_timeout=_env_int("DB_POOL_TIMEOUT", 10),
        # Serverless/managed Postgres (e.g. Neon on Replit) and PgBouncer close
        # idle connections; recycle before that happens.
        pool_recycle=_env_int("DB_POOL_RECYCLE", 300),
        pool_use_lifo=True,  # lets surplus idle connections age out under light load
        connect_args={"connect_timeout": _env_int("DB_CONNECT_TIMEOUT", 10),
                      "application_name": os.getenv("DB_APPLICATION_NAME", "pontreol-api")},
    )


engine = create_engine(DATABASE_URL, **_engine_options()) if DATABASE_URL else None
if engine is not None:
    import observability
    observability.instrument_engine(engine)
SessionLocal = sessionmaker(engine, expire_on_commit=False) if engine else None


def get_db():
    if SessionLocal is None:
        raise HTTPException(503, "Database is not configured")
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _issuer():
    configured = os.getenv("CLERK_ISSUER_URL", "").rstrip("/")
    if configured:
        return configured
    key = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    try:
        encoded = key.split("_", 2)[2]
        encoded += "=" * (-len(encoded) % 4)
        host = base64.urlsafe_b64decode(encoded).decode().rstrip("$")
        if not host or "/" in host:
            raise ValueError
        return "https://" + host
    except Exception as exc:
        raise HTTPException(503, "Clerk issuer is not configured") from exc


def _trusted_hosts():
    hosts = set()
    for value in os.getenv("ALLOWED_ORIGINS", "").split(","):
        try:
            parsed = urlparse(value.strip())
            if parsed.hostname:
                hosts.add(parsed.hostname.lower())
        except ValueError:
            pass
    for key in ("REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"):
        for value in os.getenv(key, "").split(","):
            host = value.strip().lower().split(":", 1)[0]
            if host:
                hosts.add(host)
    return hosts


def _effective_host(request: Request):
    forwarded = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    raw = forwarded or request.headers.get("host", "")
    host = raw.lower().split(":", 1)[0]
    if host in {"localhost", "127.0.0.1"}:
        return host
    return host if host in _trusted_hosts() else None


def _issuers(request: Request):
    """Allow only the configured tenant and its trusted managed custom host."""
    configured = _issuer()
    issuers = [configured]
    key = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    host = _effective_host(request)
    if key.startswith("pk_live_") and host:
        custom = f"https://clerk.{host}"
        if custom not in issuers:
            issuers.append(custom)
    return issuers


def _allowed_origins(request: Request):
    configured = {x.strip().rstrip("/") for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()}
    for key in ("REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"):
        for host in os.getenv(key, "").split(","):
            if host.strip():
                configured.add("https://" + host.strip())
    host = _effective_host(request)
    if host in {"localhost", "127.0.0.1"}:
        configured.add(f"http://{request.headers.get('host', host)}")
        configured.add(f"https://{request.headers.get('host', host)}")
    return configured


_jwks_clients = {}


def _jwks_client(issuer):
    url = os.getenv("CLERK_JWKS_URL", issuer + "/.well-known/jwks.json")
    if url not in _jwks_clients:
        _jwks_clients[url] = jwt.PyJWKClient(url, cache_keys=True, lifespan=300)
    return _jwks_clients[url]


def _same_origin_mutation(request: Request):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    site = request.headers.get("sec-fetch-site")
    origin = request.headers.get("origin")
    allowed = _allowed_origins(request)
    if site and site not in {"same-origin", "same-site", "none"}:
        raise HTTPException(403, "Cross-site mutation denied")
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(403, "Origin not allowed")


def _claims(request: Request):
    _same_origin_mutation(request)
    token = request.cookies.get("__session")
    if not token:
        raise HTTPException(401, "Authentication required")
    issuers = _issuers(request)
    issuer = issuers[0]
    try:
        key = _jwks_client(issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=["RS256"], issuer=issuers,
                            options={"require": ["exp", "iat", "iss", "sub"]})
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(503, "Clerk verification service is unavailable") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Invalid or expired session") from exc
    azp = claims.get("azp")
    if azp and azp.rstrip("/") not in _allowed_origins(request):
        raise HTTPException(401, "Session authorized party is not allowed")
    return claims


def _clerk_profile(clerk_id: str):
    secret = os.getenv("CLERK_SECRET_KEY", "")
    if not secret:
        raise HTTPException(503, "Clerk user synchronization is not configured")
    try:
        response = httpx.get(f"https://api.clerk.com/v1/users/{clerk_id}",
                             headers={"Authorization": f"Bearer {secret}"}, timeout=8)
        response.raise_for_status()
        profile = response.json()
        primary = profile.get("primary_email_address_id")
        emails = profile.get("email_addresses", [])
        email_record = next((x for x in emails if x.get("id") == primary), None)
        verification = (email_record or {}).get("verification") or {}
        email = (email_record or {}).get("email_address")
        if verification.get("status") != "verified":
            email = None
        if not email:
            raise ValueError("verified primary email missing")
        name = " ".join(x for x in [profile.get("first_name"), profile.get("last_name")] if x).strip()
        return email, name or email.split("@")[0], profile.get("image_url")
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(503, "Could not synchronize the authenticated Clerk user") from exc


def current_user(request: Request, db: Session = Depends(get_db)):
    claims = _claims(request)
    clerk_id = claims["sub"]
    user = db.scalar(select(User).where(User.clerk_user_id == clerk_id))
    if not user:
        email, name, avatar = _clerk_profile(clerk_id)
        user = User(clerk_user_id=clerk_id, email=email, display_name=name, avatar_url=avatar)
        db.add(user)
        try:
            db.flush()
        except Exception:
            db.rollback()
            user = db.scalar(select(User).where(User.clerk_user_id == clerk_id))
            if not user:
                raise
    if user.suspended:
        raise HTTPException(403, "Account is suspended")
    if user.role is None and request.url.path not in {"/api/me", "/api/me/role"}:
        raise HTTPException(403, "Complete role selection before accessing the marketplace")
    return user


def require_role(role):
    def dependency(user=Depends(current_user)):
        if user.role != role:
            raise HTTPException(403, f"{role.title()} role required")
        return user
    return dependency


def require_admin(user=Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(403, "Administrator access required")
    return user