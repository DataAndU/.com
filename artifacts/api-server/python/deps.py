"""Database and native Pontreol session dependencies."""
import os
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from models import AuthSession, User

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


def _same_origin_mutation(request: Request):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    site = request.headers.get("sec-fetch-site")
    origin = request.headers.get("origin")
    allowed = _allowed_origins(request)
    if site and site not in {"same-origin", "none"}:
        raise HTTPException(403, "Cross-site mutation denied")
    if origin and origin.rstrip("/") not in allowed:
        raise HTTPException(403, "Origin not allowed")
    if not site and not origin:
        # Browsers always send one of these on POST/PUT/PATCH/DELETE; a cookie-
        # authenticated mutation without either is not from Pontreol's pages.
        raise HTTPException(403, "Missing origin on state-changing request")


def _session_user(request: Request, db):
    """Resolve the opaque session cookie to (session, user) in one query."""
    import auth  # auth depends on this module; import lazily
    token = request.cookies.get(auth.session_cookie_name())
    if not token or len(token) > 256:
        return None, None
    row = db.execute(select(AuthSession, User).join(User, User.id == AuthSession.user_id).where(
        AuthSession.token_hash == auth.token_hash(token),
        AuthSession.revoked_at.is_(None),
        AuthSession.expires_at > auth.utcnow())).first()
    return (row[0], row[1]) if row else (None, None)


def current_user(request: Request, db: Session = Depends(get_db)):
    _same_origin_mutation(request)
    _, user = _session_user(request, db)
    if user is None:
        raise HTTPException(401, "Authentication required")
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