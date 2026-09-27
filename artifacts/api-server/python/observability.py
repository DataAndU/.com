"""Lightweight request timing and per-request SQL statement counts.

Logs only method, route template, status, duration and query count. Never
logs headers, cookies, query strings, bodies, tokens or payment data.
"""
import logging
import os
import time
from contextvars import ContextVar

from sqlalchemy import event

logger = logging.getLogger("pontreol.timing")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    logger.propagate = False
logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper() if os.getenv("LOG_LEVEL", "").upper() in
                {"DEBUG", "INFO", "WARNING", "ERROR"} else "INFO")

SLOW_MS = float(os.getenv("SLOW_REQUEST_MS", "500") or 500)
_query_count: ContextVar[list | None] = ContextVar("pontreol_query_count", default=None)
_instrumented = set()


def instrument_engine(engine):
    if id(engine) in _instrumented:
        return
    _instrumented.add(id(engine))

    @event.listens_for(engine, "before_cursor_execute")
    def _count(*_args, **_kwargs):
        counter = _query_count.get()
        if counter is not None:
            counter[0] += 1


def _route_template(scope):
    route = scope.get("route")
    path = getattr(route, "path", None)
    # Unmatched paths are logged generically so arbitrary URLs never reach logs.
    if not path:
        return "<unmatched>"
    if scope.get("path", "").startswith("/api/") and not path.startswith("/api"):
        path = "/api" + path  # routers mounted with prefix="/api"
    return path


class TimingMiddleware:
    """Pure ASGI middleware (no response buffering, safe for the Clerk proxy)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") in {"/api/healthz", "/api/readyz"}:
            return await self.app(scope, receive, send)
        start = time.perf_counter()
        counter = [0]
        token = _query_count.set(counter)
        status = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                duration = (time.perf_counter() - start) * 1000
                headers = list(message.get("headers", []))
                headers.append((b"server-timing", f"app;dur={duration:.1f}".encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            _query_count.reset(token)
            duration = (time.perf_counter() - start) * 1000
            path = _route_template(scope)
            if path.startswith("/api/__clerk"):
                path = "/api/__clerk/*"
            level = logging.WARNING if duration >= SLOW_MS else logging.INFO
            logger.log(level, "request method=%s path=%s status=%s duration_ms=%.1f db_queries=%d%s",
                       scope.get("method"), path, status["code"], duration, counter[0],
                       " slow=1" if level == logging.WARNING else "")
