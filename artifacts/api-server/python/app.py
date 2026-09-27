import os
import asyncio
from http.cookiejar import CookieJar, DefaultCookiePolicy
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

import billing_models  # registers billing tables with shared metadata
from account import router as account_router
from availability import router as availability_router
from billing import router as billing_router
from bookings import router as bookings_router
from interactions import router as interactions_router
from listings import router as listings_router
from media import router as media_router
from verification import router as verification_router
from observability import TimingMiddleware
from outbox import run_worker

# One pooled client keeps TLS connections to Clerk warm instead of paying a
# fresh TCP+TLS handshake for every proxied sign-in/session request.
_clerk_client: httpx.AsyncClient | None = None


def _no_cookie_jar():
    """The proxy is shared by every visitor: it must never remember upstream
    Set-Cookie values, or one user's session could be replayed for another.
    Browser cookies are forwarded explicitly via the Cookie header only."""
    return CookieJar(policy=DefaultCookiePolicy(allowed_domains=[]))


def _clerk_http():
    global _clerk_client
    if _clerk_client is None or _clerk_client.is_closed:
        _clerk_client = httpx.AsyncClient(
            cookies=_no_cookie_jar(),
            timeout=30, follow_redirects=False,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=10,
                                keepalive_expiry=60))
    return _clerk_client


@asynccontextmanager
async def lifespan(app):
    stop = asyncio.Event()
    worker = asyncio.create_task(run_worker(stop))
    try:
        yield
    finally:
        stop.set()
        await worker
        if _clerk_client is not None:
            await _clerk_client.aclose()

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
    return {"status": "ok"}


@app.api_route("/api/__clerk/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
               include_in_schema=False)
async def clerk_proxy(path: str, request: Request):
    """Canonical production FAPI proxy adapted for ASGI; inactive in development."""
    if os.getenv("NODE_ENV") != "production" or not os.getenv("CLERK_SECRET_KEY"):
        raise HTTPException(404, "Not found")
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    host = forwarded_host or request.headers.get("host", "")
    protocol = request.headers.get("x-forwarded-proto", "https").split(",")[0].strip()
    proxy_url = f"{protocol}://{host}/api/__clerk"
    # The browser advertises br/zstd, but httpx may not have decoders for those
    # optional formats. Never forward that negotiation to the upstream: a
    # compressed response may otherwise remain encoded after Content-Encoding
    # is stripped below, leaving the sign-in component blank despite HTTP 200.
    excluded = {"host", "accept-encoding", "content-length", "transfer-encoding", "connection",
                "keep-alive", "proxy-connection", "te", "trailer", "upgrade",
                "clerk-secret-key"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in excluded}
    headers["Accept-Encoding"] = "identity"
    headers["Clerk-Proxy-Url"] = proxy_url
    headers["Clerk-Secret-Key"] = os.environ["CLERK_SECRET_KEY"]
    client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if client_ip: headers["X-Forwarded-For"] = client_ip
    try:
        upstream = await _clerk_http().request(request.method,
            f"https://frontend-api.clerk.dev/{path}",
            params=request.query_params, headers=headers, content=await request.body())
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Clerk proxy unavailable") from exc
    # httpx decodes compressed bodies, so forwarding Content-Encoding would make
    # the browser attempt to decode the already-decoded bytes. Preserve raw
    # duplicate Set-Cookie fields instead of flattening them through a dict.
    blocked = {b"transfer-encoding", b"connection", b"keep-alive", b"proxy-connection",
               b"te", b"trailer", b"upgrade", b"content-length", b"content-encoding"}
    raw_headers = [(k, v) for k, v in upstream.headers.raw if k.lower() not in blocked]
    raw_headers.append((b"content-length", str(len(upstream.content)).encode()))
    response = Response(upstream.content, status_code=upstream.status_code, media_type=None)
    response.raw_headers = raw_headers
    return response


for router in (account_router, listings_router, media_router, availability_router,
               bookings_router, interactions_router, verification_router, billing_router):
    app.include_router(router, prefix="/api")