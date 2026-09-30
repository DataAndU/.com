import os
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.exc import ProgrammingError
from fastapi.middleware.cors import CORSMiddleware

import billing_models  # registers billing tables with shared metadata
from account import router as account_router
from auth import router as auth_router
from availability import router as availability_router
from billing import router as billing_router
from bookings import router as bookings_router
from interactions import router as interactions_router
from listings import router as listings_router
from media import router as media_router
from verification import router as verification_router
from observability import TimingMiddleware
from outbox import run_worker
from referrals import router as referrals_router
from banners import router as banners_router
from trips import router as trips_router
from free_alerts import router as free_alerts_router

@asynccontextmanager
async def lifespan(app):
    stop = asyncio.Event()
    worker = asyncio.create_task(run_worker(stop))
    try:
        yield
    finally:
        stop.set()
        await worker

app = FastAPI(title="Api", version="0.1.0",
              description="Pontreol marketplace API",
              servers=[{"url": "/api", "description": "Base API path"}],
              openapi_url="/api/openapi.json", docs_url=None, redoc_url=None,
              lifespan=lifespan)

origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Content-Type"])
app.add_middleware(TimingMiddleware)


@app.get("/api/healthz")
def health():
    """Liveness: the process is up. Deliberately independent of PostgreSQL,
    Google sign-in, storage and email so a dependency outage does not restart-loop."""
    return {"status": "ok"}


@app.get("/api/readyz")
def ready():
    """Readiness: PostgreSQL reachable. Returns 503 (no error details) when not."""
    from sqlalchemy import text
    from deps import engine
    if engine is None:
        raise HTTPException(503, "Database is not configured")
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        logging.getLogger("pontreol.health").warning("Readiness check failed: database unreachable")
        raise HTTPException(503, "Database unavailable")
    return {"status": "ready", "schema": "current" if schema_current() else "update_needed"}


# Newest additive migration per table: if these exist, migrations are applied.
EXPECTED_COLUMNS = {
    "listings": {"deal_percent", "deal_until"},
    "reviews": {"photo_ids"},
    "users": {"last_reminded_on", "available_until"},
    "notification_preferences": {"email_reminders"},
    "bookings": {"share_token_hash"},
    "society_recommendations": {"society_slug"},
    "free_alerts": {"keyword"},
}


def schema_current():
    """True when every column added by migrations exists. Names only; no data."""
    from sqlalchemy import inspect
    from deps import engine
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        return all(table in tables and columns <= {c["name"] for c in inspector.get_columns(table)}
                   for table, columns in EXPECTED_COLUMNS.items())
    except Exception:
        return False


@app.exception_handler(ProgrammingError)
async def schema_out_of_date(request, exc):
    """A missing column/table means migrations were not applied after a deploy.
    424 (not 500/503, which App Platform masks) with a clear, secret-free message."""
    code = getattr(getattr(exc, "orig", None), "sqlstate", None)
    if code in {"42703", "42P01"}:  # undefined_column, undefined_table
        logging.getLogger("pontreol.health").error(
            "Database schema is out of date: run python python/apply_migrations.py")
        return JSONResponse({"detail": "The app was updated and its database needs a quick update. "
                             "The site owner should run: python python/apply_migrations.py"}, status_code=424)
    raise exc


for router in (auth_router, account_router, listings_router, media_router, availability_router,
               bookings_router, interactions_router, verification_router, billing_router,
               referrals_router, banners_router, trips_router,
               free_alerts_router):
    app.include_router(router, prefix="/api")