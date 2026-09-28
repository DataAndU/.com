import os
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
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
    return {"status": "ready"}


for router in (auth_router, account_router, listings_router, media_router, availability_router,
               bookings_router, interactions_router, verification_router, billing_router):
    app.include_router(router, prefix="/api")