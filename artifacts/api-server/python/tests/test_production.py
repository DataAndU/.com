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


# --- DigitalOcean Spaces photo storage ---------------------------------------------

SPACES_ENV = {"SPACES_KEY": "DO00TESTKEY", "SPACES_SECRET": "spaces-secret-value",
              "SPACES_BUCKET": "pontreol-media", "SPACES_REGION": "blr1",
              "PRIVATE_OBJECT_DIR": "private"}


@pytest.fixture
def spaces_env(monkeypatch):
    for key, value in SPACES_ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(media_module, "_storage", None)
    yield
    media_module._storage = None


def test_presigned_urls_target_the_private_space_and_bind_content_type(spaces_env):
    from urllib.parse import parse_qs, urlparse
    cloud, private_dir = media_module.bucket()
    assert private_dir == "private"
    put = cloud.blob("private/u1/listingPhoto/m1.jpg").generate_signed_url(
        version="v4", expiration=timedelta(minutes=15), method="PUT", content_type="image/jpeg")
    parsed = urlparse(put)
    query = parse_qs(parsed.query)
    assert parsed.scheme == "https" and parsed.netloc == "pontreol-media.blr1.digitaloceanspaces.com"
    assert parsed.path == "/private/u1/listingPhoto/m1.jpg"
    assert query["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"] and query["X-Amz-Expires"] == ["900"]
    assert "content-type" in query["X-Amz-SignedHeaders"][0]  # browser must send the same type
    assert "blr1" in query["X-Amz-Credential"][0]
    assert "spaces-secret-value" not in put                    # secret never in the URL
    get = cloud.blob("private/u1/listingPhoto/m1.jpg").generate_signed_url(
        expiration=timedelta(hours=1), method="GET")
    assert parse_qs(urlparse(get).query)["X-Amz-Expires"] == ["3600"]


@pytest.mark.parametrize("missing", ["SPACES_KEY", "SPACES_SECRET", "SPACES_BUCKET"])
def test_missing_spaces_config_is_503_and_names_only(spaces_env, monkeypatch, caplog, missing):
    monkeypatch.delenv(missing)
    with pytest.raises(HTTPException) as error:
        media_module.bucket()
    assert error.value.status_code == 503
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert missing in logged and "spaces-secret-value" not in logged and "DO00TESTKEY" not in logged


# Intercept the Spaces endpoint so tests never reach real DigitalOcean. moto
# reads this when it is first imported, so it is set before that import.
os.environ.setdefault("MOTO_S3_CUSTOM_ENDPOINTS", "https://blr1.digitaloceanspaces.com")


@pytest.fixture
def s3(spaces_env, monkeypatch):
    moto = pytest.importorskip("moto")
    monkeypatch.setenv("SPACES_ADDRESSING_STYLE", "path")  # moto only intercepts path style
    with moto.mock_aws():
        import spaces
        spaces.make_client().create_bucket(
            Bucket="pontreol-media", CreateBucketConfiguration={"LocationConstraint": "blr1"})
        yield spaces.make_client()


def test_upload_finalize_and_serve_through_real_routes(s3, monkeypatch):
    """request_upload -> browser PUT (simulated) -> finalize -> serve."""
    from types import SimpleNamespace as NS
    from media import UploadBody, finalize, request_upload
    added = {}

    class DB:
        def add(self, obj): added["media"] = obj
        def get(self, _model, key): return added["media"] if added["media"].id == key else None
    user = NS(id="u1", is_admin=False)
    ticket = request_upload(UploadBody(purpose="listingPhoto", fileName="a.jpg",
                                       contentType="image/jpeg", sizeBytes=5), db=DB(), user=user)
    assert ticket["requiredHeaders"] == {"Content-Type": "image/jpeg"}
    assert ticket["objectPath"].startswith("private/u1/listingPhoto/")
    # What the browser does with the presigned URL:
    s3.put_object(Bucket="pontreol-media", Key=ticket["objectPath"], Body=b"12345",
                  ContentType="image/jpeg")
    result = finalize(ticket["mediaId"], db=DB(), user=user)
    assert result["media"]["status"] == "ready" and result["media"]["url"] == f"/api/media/{ticket['mediaId']}"
    media_module._signed_cache.clear()
    response = media_module.serve(ticket["mediaId"], db=DB(), user=NS(id="viewer", is_admin=False))
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://blr1.digitaloceanspaces.com/pontreol-media/private/")


def test_finalize_rejects_mismatched_or_missing_object(s3):
    from types import SimpleNamespace as NS
    from media import UploadBody, finalize, request_upload
    added = {}

    class DB:
        def add(self, obj): added["media"] = obj
        def get(self, _model, key): return added["media"]
    user = NS(id="u1", is_admin=False)
    ticket = request_upload(UploadBody(purpose="listingPhoto", fileName="a.jpg",
                                       contentType="image/jpeg", sizeBytes=5), db=DB(), user=user)
    with pytest.raises(HTTPException) as missing:
        finalize(ticket["mediaId"], db=DB(), user=user)
    assert missing.value.status_code == 422                     # nothing uploaded yet
    s3.put_object(Bucket="pontreol-media", Key=ticket["objectPath"], Body=b"much larger than declared",
                  ContentType="image/jpeg")
    with pytest.raises(HTTPException) as mismatch:
        finalize(ticket["mediaId"], db=DB(), user=user)
    assert mismatch.value.status_code == 422
    listed = s3.list_objects_v2(Bucket="pontreol-media").get("KeyCount", 0)
    assert listed == 0                                          # bad upload deleted
    assert added["media"].status != "ready"


def test_configure_spaces_sets_cors_and_reports_private(s3, monkeypatch, capsys):
    import configure_spaces
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://pontreol.com,https://x.ondigitalocean.app")
    assert configure_spaces.main() == 0
    rules = s3.get_bucket_cors(Bucket="pontreol-media")["CORSRules"]
    assert rules[0]["AllowedOrigins"] == ["https://pontreol.com", "https://x.ondigitalocean.app"]
    assert set(rules[0]["AllowedMethods"]) == {"PUT", "GET", "HEAD"}
    out = capsys.readouterr().out
    assert "private" in out and "spaces-secret-value" not in out and "DO00TESTKEY" not in out


def test_missing_column_returns_clear_424_not_500():
    from fastapi.testclient import TestClient
    from sqlalchemy.exc import ProgrammingError
    from app import app

    class Orig(Exception):
        sqlstate = "42703"

    @app.get("/api/__schema_probe")
    def probe():
        raise ProgrammingError("SELECT deal_percent", {}, Orig("column does not exist"))

    try:
        response = TestClient(app).get("/api/__schema_probe")
    finally:
        app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", "") != "/api/__schema_probe"]
    assert response.status_code == 424
    assert "apply_migrations" in response.json()["detail"] and "SELECT" not in response.text


def test_every_shipped_migration_passes_the_additive_check():
    import apply_migrations
    for path in sorted(apply_migrations.MIGRATIONS.glob("*.sql")):
        for statement in apply_migrations.statements(path.read_text()):
            assert not apply_migrations.destructive(statement), (path.name, statement)
    assert apply_migrations.destructive("ALTER TABLE users ADD COLUMN IF NOT EXISTS x TEXT DEFAULT 'a'; DROP TABLE users")
    assert apply_migrations.destructive("ALTER TABLE users DROP COLUMN email")
