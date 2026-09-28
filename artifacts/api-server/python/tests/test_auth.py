"""Email OTP sign-in and session security tests.

Resend is replaced by a recorder (the only thing simulated); challenge storage,
hashing, expiry, attempt limits, rate limits, account lookup, sessions and CSRF
are the real code paths.
"""
import logging
import os
import re
import secrets
import sys
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth
import billing_models  # noqa: F401
import deps
import outbox
from app import app
from models import AuthRateEvent, AuthSession, Base, EmailOtpChallenge, NotificationOutbox, User

ORIGIN = "https://pontreol.com"
SAME_ORIGIN = {"origin": ORIGIN}


@pytest.fixture
def maker():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


class Mailbox:
    def __init__(self):
        self.sent = []
        self.fail = None

    def __call__(self, message):
        if self.fail:
            raise self.fail
        self.sent.append(message)
        return "email_1"

    def last_code(self, email=None):
        messages = [m for m in self.sent if email is None or m["to"] == email]
        return re.search(r"\b(\d{6})\b", messages[-1]["text"]).group(1)


@pytest.fixture
def mailbox(monkeypatch):
    box = Mailbox()
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.setenv("RESEND_FROM", "Pontreol <notifications@pontreol.com>")
    monkeypatch.setenv("ALLOWED_ORIGINS", ORIGIN)
    monkeypatch.setattr(outbox, "send_via_resend", box)
    return box


@pytest.fixture
def client(maker, mailbox):
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
    yield new_client()
    app.dependency_overrides.pop(deps.get_db, None)


def new_client(ip="203.0.113.10"):
    return TestClient(app, base_url=ORIGIN, headers={"x-forwarded-for": ip})


def request_code(client, email="asha@example.com"):
    return client.post("/api/auth/otp/request", json={"email": email}, headers=SAME_ORIGIN)


def verify(client, code, email="asha@example.com", next_path="/discover"):
    return client.post("/api/auth/otp/verify", json={"email": email, "code": code, "next": next_path},
                       headers=SAME_ORIGIN)


def sign_in(client, mailbox, email="asha@example.com", next_path="/discover"):
    assert request_code(client, email).status_code == 200
    return verify(client, mailbox.last_code(email), email, next_path)


def me(client):
    return client.get("/api/me")


def age_challenges(maker, **delta):
    with maker() as db:
        for challenge in db.scalars(select(EmailOtpChallenge)):
            challenge.created_at = auth.aware(challenge.created_at) - timedelta(**delta)
            challenge.expires_at = auth.aware(challenge.expires_at) - timedelta(**delta)
        db.commit()


def existing_user(db, user_id, email, role="provider", **extra):
    user = User(id=user_id, clerk_user_id=f"user_{user_id}", google_sub=f"g-{user_id}",
                email=email, display_name=user_id, role=role, **extra)
    db.add(user)
    return user


# --- OTP request -----------------------------------------------------------------

def test_request_sends_code_and_stores_only_a_hash(client, mailbox, maker):
    response = request_code(client)
    assert response.status_code == 200
    assert response.json() == {"sent": True, "expiresIn": 600, "resendAfter": 60}
    message = mailbox.sent[-1]
    code = mailbox.last_code()
    assert message["to"] == "asha@example.com"
    assert message["from"] == "Pontreol <notifications@pontreol.com>"
    assert "Your Pontreol verification code is" in message["subject"]
    assert "expires in 10 minutes" in message["text"] and "ignore" in message["text"]
    with maker() as db:
        challenge = db.scalar(select(EmailOtpChallenge))
        assert challenge.code_hash != code and code not in challenge.code_hash
        assert challenge.code_hash == auth.hash_code(code, challenge.code_salt)
        assert db.query(User).count() == 0            # no account merely from requesting
        assert db.query(NotificationOutbox).count() == 0  # code never queued in plaintext


def test_request_response_does_not_reveal_account_existence(client, mailbox, maker):
    with maker() as db:
        existing_user(db, "old", "asha@example.com")
        db.commit()
    known = request_code(client, "asha@example.com")
    unknown = request_code(client, "nobody@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_codes_are_random_six_digits(client, mailbox, maker):
    codes = set()
    for i in range(5):
        request_code(client, f"u{i}@example.com")
        code = mailbox.last_code(f"u{i}@example.com")
        assert len(code) == 6 and code.isdigit()
        codes.add(code)
    assert len(codes) > 1


@pytest.mark.parametrize("bad", ["not-an-email", "a@b", "x" * 300 + "@example.com", "a b@example.com"])
def test_invalid_email_rejected(client, bad):
    assert request_code(client, bad).status_code == 422


def test_email_is_normalized(client, mailbox):
    request_code(client, "  Asha@Example.COM ")
    assert mailbox.sent[-1]["to"] == "asha@example.com"
    assert verify(client, mailbox.last_code(), "ASHA@example.com").status_code == 200
    assert me(client).json()["email"] == "asha@example.com"


def test_resend_cooldown(client, mailbox, maker):
    assert request_code(client).status_code == 200
    again = request_code(client)
    assert again.status_code == 429 and again.json()["detail"] == "rate_limited"
    assert 1 <= int(again.headers["retry-after"]) <= 60
    assert len(mailbox.sent) == 1
    age_challenges(maker, seconds=61)
    assert request_code(client).status_code == 200


def test_new_code_invalidates_previous_one(client, mailbox, maker):
    request_code(client)
    first = mailbox.last_code()
    age_challenges(maker, seconds=61)
    request_code(client)
    second = mailbox.last_code()
    if first != second:
        assert verify(client, first).status_code == 400
    assert verify(client, second).status_code == 200


def test_per_email_hourly_limit(client, mailbox, maker):
    for _ in range(auth.EMAIL_HOURLY_LIMIT):
        assert request_code(client).status_code == 200
        age_challenges(maker, seconds=61)
    assert request_code(client).status_code == 429


def test_per_ip_request_limit(client, mailbox, maker):
    for i in range(auth.IP_HOURLY_REQUEST_LIMIT):
        assert request_code(client, f"user{i}@example.com").status_code == 200
    assert request_code(client, "one-more@example.com").status_code == 429
    other_ip = new_client("198.51.100.7")
    assert request_code(other_ip, "one-more@example.com").status_code == 200


def test_resend_failure_is_graceful(client, mailbox, maker):
    mailbox.fail = outbox.EmailError("Email provider rejected the notification (HTTP 500)")
    response = request_code(client)
    assert response.status_code == 503 and response.json()["detail"] == "email_send_failed"
    with maker() as db:
        assert db.query(EmailOtpChallenge).count() == 0  # nothing usable left behind
    mailbox.fail = None
    assert request_code(client).status_code == 200  # failure did not start a cooldown


def test_unexpected_transport_error_is_graceful(client, mailbox):
    mailbox.fail = RuntimeError("socket details that must not leak")
    response = request_code(client)
    assert response.status_code == 503 and "socket" not in response.text


def test_email_not_configured(client, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY")
    assert request_code(client).json()["detail"] == "email_unavailable"


# --- verification ---------------------------------------------------------------

def test_new_user_created_only_after_verification(client, mailbox, maker):
    request_code(client)
    with maker() as db:
        assert db.query(User).count() == 0
    response = verify(client, mailbox.last_code())
    assert response.status_code == 200 and response.json() == {"next": "/onboarding"}
    body = me(client).json()
    assert body["email"] == "asha@example.com" and body["role"] is None


def test_incorrect_code(client, mailbox, maker):
    request_code(client)
    code = mailbox.last_code()
    wrong = f"{(int(code) + 1) % 1000000:06d}"
    response = verify(client, wrong)
    assert response.status_code == 400 and response.json()["detail"] == "invalid_code"
    assert me(client).status_code == 401
    assert verify(client, code).status_code == 200  # one miss doesn't burn the code


def test_expired_code(client, mailbox, maker):
    request_code(client)
    age_challenges(maker, minutes=11)
    response = verify(client, mailbox.last_code())
    assert response.status_code == 400 and response.json()["detail"] == "expired_code"
    assert me(client).status_code == 401


def test_code_is_single_use(client, mailbox):
    request_code(client)
    code = mailbox.last_code()
    assert verify(client, code).status_code == 200
    replay = new_client()
    response = verify(replay, code)
    assert response.status_code == 400 and response.json()["detail"] == "invalid_code"
    assert me(replay).status_code == 401


def test_too_many_attempts_burns_the_code(client, mailbox):
    request_code(client)
    code = mailbox.last_code()
    wrong = f"{(int(code) + 1) % 1000000:06d}"
    for _ in range(auth.OTP_MAX_ATTEMPTS - 1):
        assert verify(client, wrong).json()["detail"] == "invalid_code"
    assert verify(client, wrong).json()["detail"] == "too_many_attempts"
    assert verify(client, code).status_code == 400  # even the right code is now dead


def test_per_ip_failure_limit(client, mailbox, maker):
    with maker() as db:
        for _ in range(auth.IP_HOURLY_FAILURE_LIMIT):
            db.add(AuthRateEvent(ip_hash=auth.client_ip_hash(
                type("R", (), {"headers": {"x-forwarded-for": "203.0.113.10"}, "client": None})()),
                kind="otp_failed"))
        db.commit()
    request_code(client)
    assert verify(client, mailbox.last_code()).status_code == 429
    assert verify(new_client("198.51.100.9"), mailbox.last_code()).status_code == 200


def test_code_for_another_email_does_not_work(client, mailbox):
    request_code(client, "asha@example.com")
    request_code(client, "ravi@example.com")
    asha_code = mailbox.last_code("asha@example.com")
    ravi_code = mailbox.last_code("ravi@example.com")
    if asha_code != ravi_code:  # (1-in-a-million coincidence aside)
        response = verify(client, asha_code, "ravi@example.com")
        assert response.status_code == 400 and response.json()["detail"] == "invalid_code"
        assert me(client).status_code == 401
    assert verify(client, ravi_code, "ravi@example.com").status_code == 200
    assert me(client).json()["email"] == "ravi@example.com"


def test_code_with_spaces_accepted_and_garbage_rejected(client, mailbox):
    request_code(client)
    code = mailbox.last_code()
    assert verify(client, "abcdef").status_code == 400
    assert verify(client, f"{code[:3]} {code[3:]}").status_code == 200


def test_otp_never_appears_in_logs(client, mailbox, caplog):
    with caplog.at_level(logging.DEBUG):
        request_code(client)
        code = mailbox.last_code()
        verify(client, "000000" if code != "000000" else "111111")
        verify(client, code)
    everything = "\n".join(r.getMessage() for r in caplog.records)
    assert code not in everything
    assert "asha@example.com" not in everything


# --- existing accounts ------------------------------------------------------------

def test_existing_user_gets_existing_account(client, mailbox, maker):
    with maker() as db:
        existing_user(db, "old", "Asha@Example.com", is_admin=True)
        db.commit()
    response = sign_in(client, mailbox, next_path="/listings")
    assert response.json() == {"next": "/listings"}
    body = me(client).json()
    assert body["id"] == "old" and body["role"] == "provider" and body["isAdmin"] is True
    with maker() as db:
        assert db.query(User).count() == 1
        user = db.get(User, "old")
        # Legacy identities retained untouched for rollback/history.
        assert user.clerk_user_id == "user_old" and user.google_sub == "g-old"
        assert user.email == "Asha@Example.com"


def test_duplicate_email_conflict_is_not_merged(client, mailbox, maker):
    with maker() as db:
        existing_user(db, "a", "asha@example.com")
        existing_user(db, "b", "ASHA@example.com")
        db.commit()
    response = sign_in(client, mailbox)
    assert response.status_code == 409 and response.json()["detail"] == "account_conflict"
    assert me(client).status_code == 401
    with maker() as db:
        assert db.query(User).count() == 2 and db.query(AuthSession).count() == 0


def test_suspended_account_gets_no_session(client, mailbox, maker):
    with maker() as db:
        existing_user(db, "old", "asha@example.com", suspended=True)
        db.commit()
    response = sign_in(client, mailbox)
    assert response.status_code == 403 and response.json()["detail"] == "suspended"
    assert auth.session_cookie_name() not in client.cookies


# --- sessions ----------------------------------------------------------------------

def test_session_created_hashed_and_persistent(client, mailbox, maker):
    sign_in(client, mailbox)
    cookie = client.cookies.get(auth.session_cookie_name())
    with maker() as db:
        stored = db.scalar(select(AuthSession))
        assert stored.token_hash == auth.token_hash(cookie) != cookie
    assert me(client).status_code == 200 and me(client).status_code == 200


def test_production_cookie_flags(client, mailbox, monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    request_code(client)
    response = verify(client, mailbox.last_code())
    cookie = next(c for c in response.headers.get_list("set-cookie")
                  if c.startswith("__Host-pontreol_session="))
    lowered = cookie.lower()
    assert "httponly" in lowered and "secure" in lowered and "samesite=lax" in lowered
    assert "path=/" in lowered and "domain=" not in lowered and "max-age=2592000" in lowered
    assert response.headers["cache-control"] == "no-store"


def test_sign_in_rotates_presented_session(client, mailbox, maker):
    sign_in(client, mailbox)
    first = client.cookies.get(auth.session_cookie_name())
    with maker() as db:
        db.execute(update(EmailOtpChallenge).values(
            created_at=auth.utcnow() - timedelta(minutes=2)))
        db.commit()
    sign_in(client, mailbox)
    second = client.cookies.get(auth.session_cookie_name())
    assert first != second
    client.cookies.set(auth.session_cookie_name(), first)
    assert me(client).status_code == 401


def test_expired_session(client, mailbox, maker):
    sign_in(client, mailbox)
    with maker() as db:
        db.execute(update(AuthSession).values(expires_at=auth.utcnow() - timedelta(seconds=1)))
        db.commit()
    assert me(client).status_code == 401


def test_logout_revokes_server_side_session(client, mailbox, maker):
    sign_in(client, mailbox)
    stolen = client.cookies.get(auth.session_cookie_name())
    response = client.post("/api/auth/logout", headers=SAME_ORIGIN)
    assert response.status_code == 200
    client.cookies.set(auth.session_cookie_name(), stolen)
    assert me(client).status_code == 401
    with maker() as db:
        assert db.scalar(select(AuthSession)).revoked_at is not None


def test_revoked_session(client, mailbox, maker):
    sign_in(client, mailbox)
    with maker() as db:
        db.execute(update(AuthSession).values(revoked_at=auth.utcnow()))
        db.commit()
    assert me(client).status_code == 401


# --- CSRF ---------------------------------------------------------------------------

@pytest.mark.parametrize("headers", [{}, {"origin": "https://evil.example"},
                                     {"sec-fetch-site": "cross-site"}])
def test_csrf_on_every_auth_mutation(client, mailbox, headers):
    assert client.post("/api/auth/otp/request", json={"email": "a@example.com"},
                       headers=headers).status_code == 403
    assert client.post("/api/auth/otp/verify", json={"email": "a@example.com", "code": "123456"},
                       headers=headers).status_code == 403
    assert mailbox.sent == []
    sign_in(client, mailbox)
    assert client.post("/api/auth/logout", headers=headers).status_code == 403
    assert me(client).status_code == 200  # forged logout did nothing
    assert client.patch("/api/me", json={"displayName": "Hacked"}, headers=headers).status_code == 403


# --- authorization after sign-in ------------------------------------------------------

def test_roles_and_admin_come_from_database(client, mailbox, maker):
    with maker() as db:
        existing_user(db, "old", "asha@example.com", role="buyer")
        db.commit()
    sign_in(client, mailbox)
    assert client.get("/api/my/listings").status_code == 403    # provider only
    assert client.get("/api/admin/users").status_code == 403    # admin only
    client.patch("/api/me", json={"role": "provider", "isAdmin": True}, headers=SAME_ORIGIN)
    assert me(client).json()["role"] == "buyer" and me(client).json()["isAdmin"] is False
    with maker() as db:
        db.execute(update(User).values(is_admin=True, role="provider"))
        db.commit()
    assert client.get("/api/admin/users").status_code == 200
    assert client.get("/api/my/listings").status_code == 200


def test_suspension_after_sign_in_blocks_session(client, mailbox, maker):
    with maker() as db:
        existing_user(db, "old", "asha@example.com", role="buyer")
        db.commit()
    sign_in(client, mailbox)
    with maker() as db:
        db.execute(update(User).values(suspended=True))
        db.commit()
    assert me(client).status_code == 403


def test_role_less_account_limited_to_onboarding(client, mailbox):
    sign_in(client, mailbox)
    assert me(client).status_code == 200
    assert client.get("/api/listings").status_code == 403


@pytest.mark.parametrize("unsafe", ["//evil.example/x", "https://evil.example", "/\\evil.example",
                                    "/api/auth/logout", "javascript:alert(1)"])
def test_next_cannot_redirect_off_site(client, mailbox, maker, unsafe):
    with maker() as db:
        existing_user(db, "old", "asha@example.com", role="buyer")
        db.commit()
    assert sign_in(client, mailbox, next_path=unsafe).json() == {"next": "/home"}


def test_account_isolation(client, mailbox, maker):
    other = new_client("198.51.100.20")
    sign_in(client, mailbox, "asha@example.com")
    sign_in(other, mailbox, "ravi@example.com")
    assert me(client).json()["email"] == "asha@example.com"
    assert me(other).json()["email"] == "ravi@example.com"
    other.post("/api/auth/logout", headers=SAME_ORIGIN)
    assert me(client).status_code == 200
    with maker() as db:
        assert db.query(User).count() == 2


def test_signed_out_access(client):
    assert me(client).status_code == 401
    client.cookies.set(auth.session_cookie_name(), secrets.token_urlsafe(32))
    assert me(client).status_code == 401


def test_google_sign_in_routes_are_gone(client):
    assert client.get("/api/auth/google/start").status_code == 404
    assert client.get("/api/auth/google/callback").status_code == 404
