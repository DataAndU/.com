"""Regression tests for the performance work: authentication still gates every
endpoint, home summary geo filtering, constant query counts and log hygiene."""
import logging
import os
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth
import billing_models  # noqa: F401
import deps
import observability
from account import provider
from app import app
from interactions import conversations
from listings import bounding_box, haversine_km, home
from models import Base, Conversation, Listing, Message, User

SESSIONS = {}  # user id -> opaque session token (created in the client fixture)


@pytest.fixture
def engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    observability.instrument_engine(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine):
    session = sessionmaker(engine, expire_on_commit=False)()
    yield session
    session.close()


@contextmanager
def queries(engine):
    statements = []

    def record(_conn, _cursor, statement, *_args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def add_user(db, user_id, role="buyer", **extra):
    user = User(id=user_id, google_sub=f"google-{user_id}", email=f"{user_id}@example.com",
                display_name=user_id, role=role, **extra)
    db.add(user)
    return user


def add_listing(db, listing_id, lat, lng, provider_id="prov", status="active", category="services"):
    db.add(Listing(id=listing_id, provider_id=provider_id, category=category, title=listing_id,
                   description="A long description that the map view must not send",
                   price=100, pricing_mode="fixed", location_label="x", latitude=lat,
                   longitude=lng, attributes={}, status=status))


# --- geo helpers -----------------------------------------------------------

def test_haversine_known_distance():
    # New Delhi -> Mumbai is ~1150 km great-circle.
    assert 1140 < haversine_km(28.6139, 77.2090, 19.0760, 72.8777) < 1160
    assert haversine_km(12.97, 77.59, 12.97, 77.59) == 0


def test_bounding_box_contains_circle_and_handles_antimeridian(db):
    from sqlalchemy import select
    add_user(db, "prov", "provider")
    add_listing(db, "east-edge", 0, 179.95)
    add_listing(db, "west-edge", 0, -179.95)
    add_listing(db, "far", 0, 170)
    db.commit()
    ids = set(db.scalars(select(Listing.id).where(bounding_box(0, 179.99, 25))))
    assert ids == {"east-edge", "west-edge"}
    # Polar searches fall back to a latitude-only band rather than failing.
    assert bounding_box(89.99, 0, 25) is not None


# --- /home/summary -----------------------------------------------------------

@pytest.fixture
def city(db):
    add_user(db, "prov", "provider")
    base_lat, base_lng = 12.9716, 77.5946  # Bengaluru
    add_listing(db, "near-1km", base_lat + 0.009, base_lng)
    add_listing(db, "near-5km", base_lat, base_lng + 0.046)
    add_listing(db, "corner-12km", base_lat + 0.085, base_lng + 0.087)  # in box, outside circle
    add_listing(db, "far-40km", base_lat + 0.36, base_lng)
    add_listing(db, "paused-1km", base_lat - 0.009, base_lng, status="paused")
    add_listing(db, "delhi", 28.6139, 77.2090, category="spaces")
    db.commit()
    return base_lat, base_lng


def test_home_summary_returns_only_nearby_sorted_by_distance(db, engine, city):
    lat, lng = city
    with queries(engine) as sql:
        result = home(db=db, user=SimpleNamespace(id="buyer"), lat=lat, lng=lng, distanceKm=10)
    ids = [x["id"] for x in result["nearbyListings"]]
    assert ids == ["near-1km", "near-5km"]
    distances = [x["distanceKm"] for x in result["nearbyListings"]]
    assert distances == sorted(distances) and distances[0] < 1.1
    # Category totals are still global (all active listings).
    assert result["totalListings"] == 5
    # counts + bounding-box candidates + one provider batch + one photo batch.
    assert len(sql) == 4
    candidate_sql = sql[1].upper()
    assert "BETWEEN" in candidate_sql and "LIMIT" in candidate_sql


def test_home_summary_map_view_is_compact_and_skips_joins(db, engine, city):
    lat, lng = city
    with queries(engine) as sql:
        result = home(db=db, user=SimpleNamespace(id="buyer"), lat=lat, lng=lng,
                      distanceKm=10, view="map")
    assert len(sql) == 2  # no provider or photo lookups for map pins
    pin = result["nearbyListings"][0]
    assert set(pin) == {"id", "providerId", "category", "title", "price", "pricingMode",
                        "currency", "latitude", "longitude", "status", "distanceKm"}
    assert "description" not in pin


def test_home_summary_never_defaults_to_a_placeholder_city(db, city):
    # Without coordinates there is no distance filter and no synthetic location.
    result = home(db=db, user=SimpleNamespace(id="buyer"))
    assert {x["id"] for x in result["nearbyListings"]} >= {"delhi", "near-1km"}
    assert all(x["distanceKm"] is None for x in result["nearbyListings"])


# --- constant query counts ---------------------------------------------------

def test_provider_profile_query_count_is_constant(db, engine):
    add_user(db, "prov", "provider")
    for i in range(12):
        add_listing(db, f"l{i}", 12.9, 77.6)
    db.commit()
    with queries(engine) as sql:
        result = provider("prov", db=db, viewer=SimpleNamespace(id="buyer"))
    assert len(result["listings"]) == 12
    # target user + listings + provider batch + photo batch + reviews
    assert len(sql) <= 5


def test_conversation_previews_are_batched(db, engine):
    buyer = add_user(db, "buyer")
    add_user(db, "prov", "provider")
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(8):
        add_listing(db, f"l{i}", 12.9, 77.6)
        db.add(Conversation(id=f"c{i}", listing_id=f"l{i}", buyer_id="buyer", provider_id="prov",
                            last_message_at=start + timedelta(minutes=i)))
        db.add(Message(id=f"m{i}a", conversation_id=f"c{i}", sender_id="buyer", text="old",
                       created_at=start))
        db.add(Message(id=f"m{i}b", conversation_id=f"c{i}", sender_id="prov",
                       text=f"latest {i}", created_at=start + timedelta(seconds=30)))
    db.commit()
    with queries(engine) as sql:
        page = conversations(cursor=None, limit=50, db=db, user=buyer)
    assert len(sql) == 2
    assert [x["lastMessagePreview"] for x in page["items"]] == [f"latest {i}" for i in range(7, -1, -1)]


# --- HTTP: authentication stays authoritative -------------------------------

def token(user_id):
    return SESSIONS[user_id]


@pytest.fixture
def client(engine, monkeypatch):
    maker = sessionmaker(engine, expire_on_commit=False)

    def test_db():
        session = maker()
        try:
            yield session
            session.commit()
        finally:
            session.close()

    app.dependency_overrides[deps.get_db] = test_db
    with maker() as session:
        add_user(session, "buyer")
        add_user(session, "prov", "provider")
        add_user(session, "admin", "buyer", is_admin=True)
        add_user(session, "newbie", None)
        add_user(session, "banned", "buyer", suspended=True)
        add_listing(session, "l0", 12.97, 77.59)
        session.flush()
        SESSIONS.clear()
        for user_id in ("buyer", "prov", "admin", "newbie", "banned"):
            SESSIONS[user_id] = auth.create_session(session, user_id)
        session.commit()
    yield TestClient(app)
    app.dependency_overrides.pop(deps.get_db, None)


def get(client, path, sub=None, raw=None):
    client.cookies.clear()
    if sub or raw:
        client.cookies.set(auth.session_cookie_name(), raw if raw is not None else token(sub))
    return client.get(path)


@pytest.mark.parametrize("path", ["/api/me", "/api/home/summary?lat=12.97&lng=77.59",
                                  "/api/listings", "/api/listings/l0", "/api/admin/users"])
def test_signed_out_requests_are_rejected(client, path):
    assert get(client, path).status_code == 401


def test_forged_expired_and_revoked_sessions_are_rejected(client, engine):
    import secrets
    from sqlalchemy import update
    from models import AuthSession
    assert get(client, "/api/me", raw=secrets.token_urlsafe(32)).status_code == 401  # forged
    assert get(client, "/api/me", raw="x" * 300).status_code == 401                  # oversized
    maker = sessionmaker(engine, expire_on_commit=False)
    with maker() as db:
        db.execute(update(AuthSession).where(
            AuthSession.token_hash == auth.token_hash(token("prov"))).values(
            expires_at=auth.utcnow() - timedelta(seconds=1)))
        db.execute(update(AuthSession).where(
            AuthSession.token_hash == auth.token_hash(token("admin"))).values(
            revoked_at=auth.utcnow()))
        db.commit()
    assert get(client, "/api/me", "prov").status_code == 401   # expired
    assert get(client, "/api/me", "admin").status_code == 401  # revoked
    assert get(client, "/api/me", "buyer").status_code == 200  # others unaffected


def test_signed_in_me_and_marketplace_access(client):
    me = get(client, "/api/me", "buyer")
    assert me.status_code == 200 and me.json()["role"] == "buyer" and me.json()["isAdmin"] is False
    summary = get(client, "/api/home/summary?lat=12.97&lng=77.59&distanceKm=10&view=map", "buyer")
    assert summary.status_code == 200
    assert [x["id"] for x in summary.json()["nearbyListings"]] == ["l0"]
    assert get(client, "/api/listings/l0", "buyer").status_code == 200


def test_role_admin_and_suspension_are_enforced_server_side(client):
    # Role-less accounts may read /api/me (to onboard) but nothing else.
    assert get(client, "/api/me", "newbie").status_code == 200
    assert get(client, "/api/home/summary?lat=1&lng=1", "newbie").status_code == 403
    assert get(client, "/api/me", "banned").status_code == 403
    assert get(client, "/api/admin/users", "buyer").status_code == 403
    assert get(client, "/api/admin/users", "prov").status_code == 403
    assert get(client, "/api/admin/users", "admin").status_code == 200
    assert get(client, "/api/my/listings", "buyer").status_code == 403
    assert get(client, "/api/my/listings", "prov").status_code == 200


def test_home_summary_rejects_invalid_coordinates(client):
    assert get(client, "/api/home/summary?lat=123&lng=1", "buyer").status_code == 422
    assert get(client, "/api/home/summary?lat=1&lng=1&distanceKm=0", "buyer").status_code == 422


def test_cross_site_mutation_still_denied_before_auth(client):
    client.cookies.clear()
    client.cookies.set(auth.session_cookie_name(), token("buyer"))
    response = client.patch("/api/me", json={"displayName": "x"},
                            headers={"sec-fetch-site": "cross-site"})
    assert response.status_code == 403


def test_timing_log_has_route_template_and_no_sensitive_values(client, caplog):
    observability.logger.propagate = True
    try:
        with caplog.at_level(logging.INFO, logger="pontreol.timing"):
            secret = token("buyer")
            client.cookies.clear()
            client.cookies.set(auth.session_cookie_name(), secret)
            response = client.get("/api/listings/l0?lat=12.97&lng=77.59")
    finally:
        observability.logger.propagate = False
    assert response.status_code == 200
    assert response.headers["server-timing"].startswith("app;dur=")
    lines = [r.getMessage() for r in caplog.records if r.name == "pontreol.timing"]
    assert any("path=/api/listings/{listing_id}" in x and "status=200" in x and
               "db_queries=" in x and "db_queries=0" not in x for x in lines)
    joined = "\n".join(lines)
    assert secret not in joined and "12.97" not in joined and "l0" not in joined
