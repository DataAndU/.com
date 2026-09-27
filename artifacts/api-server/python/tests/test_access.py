import asyncio
import os
import sys
import base64
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from account import RoleBody, set_role
from deps import _issuers, _same_origin_mutation, require_admin, require_role
from models import User
from app import clerk_proxy


class ScalarDB:
    def __init__(self, value):
        self.value = value

    def scalar(self, _statement):
        return self.value

    def flush(self):
        pass


def request(method="POST", origin="https://app.example"):
    headers = [(b"host", b"app.example"), (b"origin", origin.encode()),
               (b"sec-fetch-site", b"same-origin")]
    return Request({"type": "http", "method": method, "scheme": "https",
                    "server": ("app.example", 443), "path": "/api/me/role",
                    "headers": headers})


def test_role_selection_is_permanent(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    user = User(id="00000000-0000-0000-0000-000000000001",
                clerk_user_id="user_1", email="a@example.com", display_name="A")
    db = ScalarDB(user)
    assert set_role(RoleBody(role="buyer"), db, user)["role"] == "buyer"
    with pytest.raises(HTTPException) as denied:
        set_role(RoleBody(role="provider"), db, user)
    assert denied.value.status_code == 409


def test_role_dependency_denies_other_role():
    with pytest.raises(HTTPException) as denied:
        require_role("provider")(SimpleNamespace(role="buyer"))
    assert denied.value.status_code == 403


def test_admin_is_separate_from_marketplace_role():
    with pytest.raises(HTTPException) as denied:
        require_admin(SimpleNamespace(is_admin=False, role="provider"))
    assert denied.value.status_code == 403
    admin = SimpleNamespace(is_admin=True, role="provider")
    assert require_admin(admin) is admin


def test_cross_origin_mutation_is_denied(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    with pytest.raises(HTTPException) as denied:
        _same_origin_mutation(request(origin="https://evil.example"))
    assert denied.value.status_code == 403


def test_production_custom_issuer_requires_trusted_public_host(monkeypatch):
    encoded = base64.urlsafe_b64encode(b"tenant.clerk.accounts.dev$").decode().rstrip("=")
    monkeypatch.setenv("CLERK_PUBLISHABLE_KEY", "pk_live_" + encoded)
    monkeypatch.setenv("REPLIT_DOMAINS", "pontreol.com")
    trusted = Request({"type": "http", "method": "GET", "scheme": "https",
        "server": ("internal", 443), "path": "/api/me",
        "headers": [(b"host", b"internal"), (b"x-forwarded-host", b"pontreol.com, proxy")]})
    assert _issuers(trusted) == [
        "https://tenant.clerk.accounts.dev",
        "https://clerk.pontreol.com",
    ]
    spoofed = Request({"type": "http", "method": "GET", "scheme": "https",
        "server": ("evil.example", 443), "path": "/api/me",
        "headers": [(b"host", b"evil.example")]})
    assert _issuers(spoofed) == ["https://tenant.clerk.accounts.dev"]


def test_clerk_proxy_does_not_forward_unsupported_browser_compression(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("CLERK_SECRET_KEY", "test-secret")
    captured = {}

    class MockClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def request(self, method, url, **kwargs):
            captured.update(method=method, url=url, **kwargs)
            return httpx.Response(
                200,
                content=b"window.Clerk = {};",
                headers={"content-type": "application/javascript"},
            )

    monkeypatch.setattr("app.httpx.AsyncClient", MockClient)
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    req = Request({
        "type": "http", "method": "GET", "scheme": "https",
        "server": ("internal", 443), "path": "/api/__clerk/npm/@clerk/clerk-js",
        "query_string": b"v=1",
        "headers": [
            (b"host", b"internal"),
            (b"x-forwarded-host", b"pontreol.com"),
            (b"x-forwarded-proto", b"https"),
            (b"accept-encoding", b"gzip, deflate, br, zstd"),
        ],
    }, receive)
    response = asyncio.run(clerk_proxy("npm/@clerk/clerk-js", req))
    assert response.status_code == 200
    assert response.body == b"window.Clerk = {};"
    assert captured["headers"]["Accept-Encoding"] == "identity"
    assert captured["headers"]["Clerk-Proxy-Url"] == "https://pontreol.com/api/__clerk"
    assert captured["url"] == "https://frontend-api.clerk.dev/npm/@clerk/clerk-js"