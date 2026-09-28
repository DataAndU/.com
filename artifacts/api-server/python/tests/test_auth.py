"""Native Google OIDC sign-in and session security tests.

Google is simulated with a locally generated RSA key: discovery, the token
endpoint and JWKS are replaced, everything else (state, nonce, PKCE, cookie
binding, ID-token verification, account linking, sessions, CSRF) is real.
"""
import base64
import hashlib
import os
import secrets
import sys
import time
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth
import billing_models  # noqa: F401
import deps
from app import app
from models import AuthSession, Base, OAuthLoginAttempt, User

CLIENT_ID = "pontreol-test.apps.googleusercontent.com"
GOOGLE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ORIGIN = "https://pontreol.com"


@pytest.fixture
def maker():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


class Google:
    """Programmable fake of Google's token endpoint."""

    def __init__(self):
        self.claims = {}
        self.key = GOOGLE_KEY
        self.status = 200
        self.last_form = None

    def id_token(self, nonce):
        now = int(time.time())
        claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "azp": CLIENT_ID,
                  "sub": "google-sub-1", "email": "asha@example.com", "email_verified": True,
                  "name": "Asha", "picture": "https://lh3.googleusercontent.com/a/x",
                  "iat": now, "exp": now + 300, "nonce": nonce}
        claims.update(self.claims)
        return jwt.encode({k: v for k, v in claims.items() if v is not ...}, self.key,
                          algorithm="RS256", headers={"kid": "k1"})


@pytest.fixture
def google(monkeypatch):
    fake = Google()
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ALLOWED_ORIGINS", ORIGIN)
    monkeypatch.delenv("GOOGLE_REDIRECT_URI", raising=False)
    monkeypatch.setattr(auth, "discovery", lambda: {
        "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs"})
    monkeypatch.setattr(auth, "jwks_client", lambda uri: SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=GOOGLE_KEY.public_key())))

    def token_endpoint(url, data=None, **kwargs):
        fake.last_form = data
        if fake.status != 200:
            return httpx.Response(fake.status, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"id_token": fake.id_token(fake.nonce)})
    monkeypatch.setattr(auth.httpx, "post", token_endpoint)
    return fake


@pytest.fixture
def client(maker, google):
    def test_db():
        session = maker()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
    app.dependency_overrides[deps.get_db] = test_db
    yield TestClient(app, base_url=ORIGIN, follow_redirects=False)
    app.dependency_overrides.pop(deps.get_db, None)


def start(client, google, next_path="/discover"):
    response = client.get(f"/api/auth/google/start?next={next_path}")
    assert response.status_code == 302
    query = parse_qs(urlparse(response.headers["location"]).query)
    google.nonce = query["nonce"][0]
    return response, query


def sign_in(client, google, next_path="/discover", **claims):
    google.claims = claims
    _, query = start(client, google, next_path)
    return client.get(f"/api/auth/google/callback?code=auth-code&state={query['state'][0]}")


def me(client):
    return client.get("/api/me")


# --- authorization request ----------------------------------------------------

def test_start_uses_code_flow_with_state_nonce_pkce(client, google):
    response, query = start(client, google)
    assert response.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert query["response_type"] == ["code"] and query["client_id"] == [CLIENT_ID]
    assert query["redirect_uri"] == [f"{ORIGIN}/api/auth/google/callback"]
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    assert len(query["state"][0]) >= 32 and len(query["nonce"][0]) >= 32
    login_cookie = response.headers["set-cookie"]
    assert "httponly" in login_cookie.lower() and "samesite=lax" in login_cookie.lower()


def test_pkce_verifier_is_sent_and_matches_challenge(client, google):
    _, query = start(client, google)
    client.get(f"/api/auth/google/callback?code=c&state={query['state'][0]}")
    verifier = google.last_form["code_verifier"]
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    assert query["code_challenge"] == [expected]
    assert google.last_form["redirect_uri"] == f"{ORIGIN}/api/auth/google/callback"


def test_not_configured_returns_503(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
    assert client.get("/api/auth/google/start").status_code == 503


# --- successful identity, sessions --------------------------------------------

def test_successful_sign_in_creates_user_and_session(client, google, maker):
    response = sign_in(client, google)
    assert response.status_code == 302
    assert response.headers["location"] == "/onboarding"  # new account has no role yet
    body = me(client)
    assert body.status_code == 200
    assert body.json()["email"] == "asha@example.com" and body.json()["role"] is None
    assert "clerkUserId" not in body.json()
    with maker() as db:
        user = db.scalar(select(User))
        assert user.google_sub == "google-sub-1" and user.clerk_user_id is None
        stored = db.scalar(select(AuthSession))
        cookie = client.cookies.get(auth.session_cookie_name())
        assert stored.token_hash == auth.token_hash(cookie) and stored.token_hash != cookie
        assert db.scalar(select(OAuthLoginAttempt)) is None  # consumed


def test_session_persists_and_role_user_goes_to_next(client, google, maker):
    sign_in(client, google)
    with maker() as db:
        db.execute(update(User).values(role="buyer"))
        db.commit()
    assert me(client).json()["role"] == "buyer"
    assert me(client).status_code == 200  # persists across requests
    second = sign_in(client, google, next_path="/discover")
    assert second.headers["location"] == "/discover"
    with maker() as db:
        assert db.query(User).count() == 1  # no duplicate on repeat sign-in


def test_production_cookie_flags(client, google, monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    response = sign_in(client, google)
    cookies = response.headers.get_list("set-cookie")
    session = next(c for c in cookies if c.startswith("__Host-pontreol_session="))
    lowered = session.lower()
    assert "httponly" in lowered and "secure" in lowered and "samesite=lax" in lowered
    assert "path=/" in lowered and "domain=" not in lowered and "max-age=2592000" in lowered


def test_expired_session_is_rejected(client, google, maker):
    sign_in(client, google)
    with maker() as db:
        db.execute(update(AuthSession).values(expires_at=auth.utcnow() - timedelta(seconds=1)))
        db.commit()
    assert me(client).status_code == 401


def test_logout_revokes_server_side_session(client, google, maker):
    sign_in(client, google)
    stolen = client.cookies.get(auth.session_cookie_name())
    response = client.post("/api/auth/logout", headers={"origin": ORIGIN})
    assert response.status_code == 200
    assert auth.session_cookie_name() in response.headers["set-cookie"]
    client.cookies.set(auth.session_cookie_name(), stolen)  # replaying the old cookie
    assert me(client).status_code == 401
    with maker() as db:
        assert db.scalar(select(AuthSession)).revoked_at is not None


def test_logout_requires_same_origin(client, google):
    sign_in(client, google)
    assert client.post("/api/auth/logout", headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/auth/logout").status_code == 403  # no origin signal
    assert me(client).status_code == 200  # CSRF attempt did not sign the user out


def test_new_login_revokes_presented_session(client, google, maker):
    """Session fixation: a pre-existing cookie never survives a login."""
    sign_in(client, google)
    first = client.cookies.get(auth.session_cookie_name())
    sign_in(client, google)
    second = client.cookies.get(auth.session_cookie_name())
    assert first != second
    client.cookies.set(auth.session_cookie_name(), first)
    assert me(client).status_code == 401


# --- rejected identities --------------------------------------------------------

def assert_failed(response, code="failed"):
    assert response.status_code == 302
    assert response.headers["location"] == f"/sign-in?error={code}"


def test_invalid_state(client, google, maker):
    start(client, google)
    assert_failed(client.get("/api/auth/google/callback?code=c&state=forged"))
    assert me(client).status_code == 401
    with maker() as db:
        assert db.query(User).count() == 0


def test_missing_login_cookie_is_login_csrf(client, google):
    _, query = start(client, google)
    client.cookies.clear()  # attacker's callback URL opened in victim's browser
    assert_failed(client.get(f"/api/auth/google/callback?code=c&state={query['state'][0]}"), "expired")


def test_callback_replay_is_rejected(client, google):
    _, query = start(client, google)
    url = f"/api/auth/google/callback?code=c&state={query['state'][0]}"
    login_cookie = client.cookies.get(auth.login_cookie_name())
    assert client.get(url).headers["location"] == "/onboarding"
    client.cookies.set(auth.login_cookie_name(), login_cookie)
    assert_failed(client.get(url), "expired")


def test_expired_login_attempt(client, google, maker):
    _, query = start(client, google)
    with maker() as db:
        db.execute(update(OAuthLoginAttempt).values(created_at=auth.utcnow() - timedelta(minutes=11)))
        db.commit()
    assert_failed(client.get(f"/api/auth/google/callback?code=c&state={query['state'][0]}"), "expired")


@pytest.mark.parametrize("claims", [
    {"nonce": "attacker-nonce"},                                   # invalid nonce
    {"nonce": ...},                                                # missing nonce
    {"iss": "https://evil.example"},                               # invalid issuer
    {"aud": "someone-else.apps.googleusercontent.com"},            # wrong audience
    {"azp": "someone-else.apps.googleusercontent.com"},            # wrong authorized party
    {"exp": int(time.time()) - 120, "iat": int(time.time()) - 600},  # expired token
    {"email_verified": False},                                     # unverified email
    {"email_verified": "true"},                                    # not a real boolean
    {"email": ...},                                                # no email
])
def test_invalid_id_token_claims_are_rejected(client, google, maker, claims):
    assert_failed(sign_in(client, google, **claims))
    assert me(client).status_code == 401
    with maker() as db:
        assert db.query(User).count() == 0 and db.query(AuthSession).count() == 0


def test_forged_token_signature_is_rejected(client, google, maker):
    google.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert_failed(sign_in(client, google))
    with maker() as db:
        assert db.query(User).count() == 0


def test_google_rejects_code(client, google):
    google.status = 400
    assert_failed(sign_in(client, google))


def test_user_cancelled_at_google(client, google):
    _, query = start(client, google)
    assert_failed(client.get(f"/api/auth/google/callback?error=access_denied&state={query['state'][0]}"),
                  "cancelled")


@pytest.mark.parametrize("unsafe", ["//evil.example/x", "https://evil.example", "/\\evil.example",
                                    "/api/auth/logout", "javascript:alert(1)"])
def test_open_redirects_are_blocked(client, google, maker, unsafe):
    sign_in(client, google)
    with maker() as db:
        db.execute(update(User).values(role="buyer"))
        db.commit()
    assert sign_in(client, google, next_path=unsafe).headers["location"] == "/home"


# --- account linking (Clerk -> Google) ----------------------------------------------

def legacy_user(db, user_id, email, role="provider", **extra):
    user = User(id=user_id, clerk_user_id=f"user_{user_id}", email=email,
                display_name=user_id, role=role, **extra)
    db.add(user)
    return user


def test_clerk_era_account_links_by_verified_email(client, google, maker):
    with maker() as db:
        legacy_user(db, "old", "Asha@Example.com", is_admin=True)
        db.commit()
    response = sign_in(client, google, next_path="/listings")
    assert response.headers["location"] == "/listings"
    body = me(client).json()
    assert body["id"] == "old" and body["role"] == "provider" and body["isAdmin"] is True
    with maker() as db:
        user = db.get(User, "old")
        assert user.google_sub == "google-sub-1" and user.clerk_user_id == "user_old"
        assert db.query(User).count() == 1


def test_unverified_email_never_links(client, google, maker):
    with maker() as db:
        legacy_user(db, "old", "asha@example.com", is_admin=True)
        db.commit()
    assert_failed(sign_in(client, google, email_verified=False))
    with maker() as db:
        assert db.get(User, "old").google_sub is None


def test_email_owned_by_other_google_account_is_not_merged(client, google, maker):
    with maker() as db:
        legacy_user(db, "old", "asha@example.com", google_sub="google-sub-OTHER")
        db.commit()
    assert_failed(sign_in(client, google))
    with maker() as db:
        assert db.get(User, "old").google_sub == "google-sub-OTHER"
        assert db.query(User).count() == 1


def test_ambiguous_duplicate_emails_are_not_merged(client, google, maker):
    with maker() as db:
        legacy_user(db, "a", "asha@example.com")
        legacy_user(db, "b", "ASHA@example.com")
        db.commit()
    assert_failed(sign_in(client, google))
    with maker() as db:
        assert all(u.google_sub is None for u in db.query(User))


# --- authorization after sign-in ------------------------------------------------------

def test_suspended_account_gets_no_session(client, google, maker):
    with maker() as db:
        legacy_user(db, "old", "asha@example.com", suspended=True)
        db.commit()
    assert_failed(sign_in(client, google), "suspended")
    assert auth.session_cookie_name() not in client.cookies


def test_suspension_after_sign_in_blocks_existing_session(client, google, maker):
    with maker() as db:
        legacy_user(db, "old", "asha@example.com", role="buyer")
        db.commit()
    sign_in(client, google)
    assert me(client).status_code == 200
    with maker() as db:
        db.execute(update(User).values(suspended=True))
        db.commit()
    assert me(client).status_code == 403


def test_roles_and_admin_come_from_database_not_client(client, google, maker):
    with maker() as db:
        legacy_user(db, "old", "asha@example.com", role="buyer")
        db.commit()
    sign_in(client, google)
    assert client.get("/api/my/listings").status_code == 403           # provider-only
    assert client.get("/api/admin/users").status_code == 403           # admin-only
    # Client-supplied role/admin claims are ignored.
    patched = client.patch("/api/me", json={"role": "provider", "isAdmin": True},
                           headers={"origin": ORIGIN})
    assert patched.status_code == 200
    assert me(client).json()["role"] == "buyer" and me(client).json()["isAdmin"] is False
    with maker() as db:
        db.execute(update(User).values(is_admin=True))
        db.commit()
    assert client.get("/api/admin/users").status_code == 200


def test_role_less_account_is_limited_to_onboarding(client, google):
    sign_in(client, google)
    assert me(client).status_code == 200
    assert client.get("/api/listings").status_code == 403


def test_cookie_mutation_without_origin_is_rejected(client, google):
    sign_in(client, google)
    response = client.patch("/api/me", json={"displayName": "Hacked"})
    assert response.status_code == 403
    cross = client.patch("/api/me", json={"displayName": "Hacked"},
                         headers={"origin": "https://evil.example"})
    assert cross.status_code == 403
    assert me(client).json()["displayName"] == "Asha"


def test_account_isolation(client, google, maker):
    other = TestClient(app, base_url=ORIGIN, follow_redirects=False)
    sign_in(client, google)
    sign_in(other, google, sub="google-sub-2", email="ravi@example.com", name="Ravi")
    assert me(client).json()["email"] == "asha@example.com"
    assert me(other).json()["email"] == "ravi@example.com"
    other.post("/api/auth/logout", headers={"origin": ORIGIN})
    assert me(client).status_code == 200  # one user's logout never affects another
    with maker() as db:
        assert db.query(User).count() == 2


def test_signed_out_access(client):
    assert me(client).status_code == 401
    client.cookies.set(auth.session_cookie_name(), secrets.token_urlsafe(32))
    assert me(client).status_code == 401
