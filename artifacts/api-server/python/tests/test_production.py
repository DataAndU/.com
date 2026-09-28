"""Production-readiness regressions: photo delivery, email transport, health."""
import os
import sys
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import media as media_module
import outbox
from common import media_json
from models import Media


def make_media(**extra):
    base = dict(id="m1", owner_id="owner", purpose="listingPhoto",
                object_path="private/owner/listingPhoto/m1.jpg", content_type="image/jpeg",
                size_bytes=10, status="ready", is_private=False)
    base.update(extra)
    return Media(**base)


# --- photo delivery ----------------------------------------------------------

def test_media_json_exposes_browser_url_not_storage_path():
    payload = media_json(make_media())
    assert payload["url"] == "/api/media/m1"
    assert not payload["url"].startswith("private/")


class FakeDB:
    def __init__(self, item):
        self.item = item

    def get(self, _model, key):
        return self.item if self.item and self.item.id == key else None


class FakeBucket:
    def __init__(self, fail=False):
        self.signed = 0
        self.fail = fail

    def blob(self, path):
        bucket = self

        class Blob:
            def generate_signed_url(self, **kwargs):
                if bucket.fail:
                    raise RuntimeError("storage down")
                bucket.signed += 1
                assert kwargs["method"] == "GET" and kwargs["expiration"] == timedelta(hours=1)
                return f"https://storage.example/{path}?sig={bucket.signed}"
        return Blob()


@pytest.fixture
def bucket(monkeypatch):
    fake = FakeBucket()
    media_module._signed_cache.clear()
    monkeypatch.setattr(media_module, "bucket", lambda: (fake, "private"))
    return fake


def test_serve_redirects_and_reuses_signed_url(bucket):
    viewer = SimpleNamespace(id="viewer", is_admin=False)
    db = FakeDB(make_media())
    first = media_module.serve("m1", db=db, user=viewer)
    second = media_module.serve("m1", db=db, user=viewer)
    assert first.status_code == 302
    assert first.headers["location"] == second.headers["location"]
    assert bucket.signed == 1  # signed once, reused
    assert first.headers["cache-control"] == "private, max-age=300"


def test_private_media_denied_to_others_even_when_cached(bucket):
    private = make_media(is_private=True, purpose="verificationId")
    owner = SimpleNamespace(id="owner", is_admin=False)
    assert media_module.serve("m1", db=FakeDB(private), user=owner).headers[
        "cache-control"] == "private, no-store"
    with pytest.raises(HTTPException) as denied:
        media_module.serve("m1", db=FakeDB(private), user=SimpleNamespace(id="x", is_admin=False))
    assert denied.value.status_code == 404
    admin = SimpleNamespace(id="admin", is_admin=True)
    assert media_module.serve("m1", db=FakeDB(private), user=admin).status_code == 302


def test_missing_pending_and_storage_outage(monkeypatch):
    viewer = SimpleNamespace(id="v", is_admin=False)
    with pytest.raises(HTTPException) as missing:
        media_module.serve("nope", db=FakeDB(None), user=viewer)
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as pending:
        media_module.serve("m1", db=FakeDB(make_media(status="pending")), user=viewer)
    assert pending.value.status_code == 404
    media_module._signed_cache.clear()
    monkeypatch.setattr(media_module, "bucket", lambda: (FakeBucket(fail=True), "private"))
    with pytest.raises(HTTPException) as outage:
        media_module.serve("m1", db=FakeDB(make_media()), user=viewer)
    assert outage.value.status_code == 503


# --- Resend transport --------------------------------------------------------

MESSAGE = {"from": "Pontreol <n@pontreol.com>", "to": "user@example.com",
           "subject": "Hi", "text": "Body", "idempotencyKey": "outbox-1"}


def client_for(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_resend_success_sends_expected_request(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_secret_value")
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["authorization"]
        seen["idem"] = request.headers["idempotency-key"]
        seen["body"] = request.content
        return httpx.Response(200, json={"id": "email_123"})
    assert outbox.send_via_resend(MESSAGE, client_for(handler)) == "email_123"
    assert seen["auth"] == "Bearer re_secret_value" and seen["idem"] == "outbox-1"
    assert b'"to":["user@example.com"]' in seen["body"].replace(b" ", b"")


@pytest.mark.parametrize("handler", [
    lambda r: httpx.Response(401, json={"message": "bad key re_secret_value"}),
    lambda r: httpx.Response(200, json={}),
    lambda r: (_ for _ in ()).throw(httpx.ConnectError("down", request=r)),
])
def test_resend_failures_are_safe(monkeypatch, handler):
    monkeypatch.setenv("RESEND_API_KEY", "re_secret_value")
    with pytest.raises(outbox.EmailError) as error:
        outbox.send_via_resend(MESSAGE, client_for(handler))
    text = str(error.value)
    assert "re_secret_value" not in text and "user@example.com" not in text


def test_resend_missing_key_fails_closed(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with pytest.raises(outbox.EmailError):
        outbox.send_via_resend(MESSAGE, client_for(lambda r: httpx.Response(200, json={"id": "x"})))


# --- health ------------------------------------------------------------------

def test_liveness_independent_of_database_and_readiness_reports_outage(monkeypatch):
    import deps
    from app import app
    from sqlalchemy import create_engine
    client = TestClient(app)
    dead = create_engine("postgresql+psycopg://u:p@127.0.0.1:1/none",
                         connect_args={"connect_timeout": 1})
    monkeypatch.setattr(deps, "engine", dead)
    assert client.get("/api/healthz").status_code == 200
    response = client.get("/api/readyz")
    assert response.status_code == 503 and "u:p" not in response.text
    monkeypatch.setattr(deps, "engine", None)
    assert client.get("/api/readyz").status_code == 503


def test_clerk_jwks_outage_returns_503_not_crash(monkeypatch):
    import jwt as pyjwt
    import deps
    from starlette.requests import Request
    monkeypatch.setenv("CLERK_ISSUER_URL", "https://tenant.clerk.accounts.dev")

    def unavailable(_token):
        raise pyjwt.PyJWKClientConnectionError("jwks down")
    monkeypatch.setattr(deps, "_jwks_client",
                        lambda issuer: SimpleNamespace(get_signing_key_from_jwt=unavailable))
    request = Request({"type": "http", "method": "GET", "path": "/api/me", "query_string": b"",
                       "headers": [(b"cookie", b"__session=abc"), (b"host", b"localhost")]})
    with pytest.raises(HTTPException) as error:
        deps._claims(request)
    assert error.value.status_code == 503


# --- Google Cloud credentials from environment (App Platform) ---------------

def test_gcs_credentials_from_env_json_and_base64(monkeypatch):
    import base64
    import json as jsonlib
    key = {"type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----\nX\n",
           "client_email": "svc@proj.iam.gserviceaccount.com", "project_id": "proj"}
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", jsonlib.dumps(key))
    assert media_module._service_account_info() == key
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON",
                       base64.b64encode(jsonlib.dumps(key).encode()).decode())
    assert media_module._service_account_info() == key
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    assert media_module._service_account_info() is None


@pytest.mark.parametrize("value", ["{not json", "!!!notbase64", '{"type": "authorized_user"}'])
def test_invalid_gcs_credentials_fail_safely(monkeypatch, value, caplog):
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", value)
    with pytest.raises(ValueError) as error:
        media_module._service_account_info()
    assert value not in str(error.value)
    # Through the endpoint path: 503, logged without the secret value.
    monkeypatch.setattr(media_module, "_storage_client", None)
    monkeypatch.setenv("DEFAULT_OBJECT_STORAGE_BUCKET_ID", "b")
    monkeypatch.setenv("PRIVATE_OBJECT_DIR", "private")
    with pytest.raises(HTTPException) as unavailable:
        media_module.bucket()
    assert unavailable.value.status_code == 503
    assert all(value not in record.getMessage() for record in caplog.records)


def test_gcs_client_built_from_env_key(monkeypatch):
    import json as jsonlib
    captured = {}

    class FakeClient:
        @classmethod
        def from_service_account_info(cls, info):
            captured["info"] = info
            return cls()
    key = {"type": "service_account", "private_key": "k", "client_email": "e", "project_id": "p"}
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", jsonlib.dumps(key))
    monkeypatch.setattr(media_module, "_storage_client", None)
    monkeypatch.setattr(media_module.storage, "Client", FakeClient)
    assert isinstance(media_module._client(), FakeClient) and captured["info"] == key
