"""Growth features: "Available now", badges, referrals, trip sharing, bundles."""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth
import billing_models  # noqa: F401
import deps
from app import app
from models import Base, Listing, User

ORIGIN = "https://pontreol.com"
SAME = {"origin": ORIGIN}


@pytest.fixture
def maker(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", ORIGIN)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def people(maker):
    def test_db():
        session = maker()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[deps.get_db] = test_db
    clients = {}
    with maker() as db:
        for uid, role in (("prov", "provider"), ("prov2", "provider"), ("buyer", "buyer")):
            db.add(User(id=uid, email=f"{uid}@example.com", display_name=uid, role=role))
        db.flush()
        for uid in ("prov", "prov2", "buyer"):
            client = TestClient(app, base_url=ORIGIN)
            client.cookies.set(auth.session_cookie_name(), auth.create_session(db, uid))
            clients[uid] = client
        db.add(Listing(id="l-prov", provider_id="prov", category="services", title="Plumber",
                       description="Fixes pipes quickly", price=300, pricing_mode="fixed",
                       location_label="Koramangala", latitude=12.93, longitude=77.62, attributes={}))
        db.add(Listing(id="l-prov2", provider_id="prov2", category="services", title="Electrician",
                       description="Fixes wiring quickly", price=400, pricing_mode="fixed",
                       location_label="Koramangala", latitude=12.931, longitude=77.621, attributes={}))
        db.commit()
    yield clients
    app.dependency_overrides.pop(deps.get_db, None)


def map_pins(client):
    body = client.get("/api/home/summary?lat=12.93&lng=77.62&distanceKm=10&view=map").json()
    return {pin["id"]: pin for pin in body["nearbyListings"]}


# --- Available now -------------------------------------------------------------------

def test_available_now_turns_pins_green_and_expires(people, maker):
    prov, buyer = people["prov"], people["buyer"]
    assert map_pins(buyer)["l-prov"]["availableNow"] is False
    response = prov.put("/api/me/availability", json={"available": True, "hours": 2}, headers=SAME)
    assert response.status_code == 200 and response.json()["availableNow"] is True
    pins = map_pins(buyer)
    assert pins["l-prov"]["availableNow"] is True and pins["l-prov2"]["availableNow"] is False
    assert buyer.get("/api/listings/l-prov").json()["provider"]["availableNow"] is True
    with maker() as db:  # time passes beyond the chosen window
        db.execute(update(User).where(User.id == "prov").values(
            available_until=datetime.now(timezone.utc) - timedelta(minutes=1)))
        db.commit()
    assert map_pins(buyer)["l-prov"]["availableNow"] is False


def test_available_now_can_be_switched_off(people):
    prov = people["prov"]
    prov.put("/api/me/availability", json={"available": True}, headers=SAME)
    off = prov.put("/api/me/availability", json={"available": False}, headers=SAME)
    assert off.json()["availableNow"] is False and off.json()["availableUntil"] is None


def test_available_now_is_provider_only_and_csrf_protected(people):
    assert people["buyer"].put("/api/me/availability", json={"available": True},
                               headers=SAME).status_code == 403
    assert people["prov"].put("/api/me/availability", json={"available": True}).status_code == 403
    assert people["prov"].put("/api/me/availability", json={"available": True, "hours": 99},
                              headers=SAME).status_code == 422


# --- Badges -------------------------------------------------------------------------

def badges_of(client, listing_id="l-prov"):
    return client.get(f"/api/listings/{listing_id}").json()["provider"]["badges"]


def test_verified_badge_follows_verification_status(people, maker):
    assert "verified" not in badges_of(people["buyer"])
    with maker() as db:
        db.execute(update(User).where(User.id == "prov").values(verification_status="verified"))
        db.commit()
    assert "verified" in badges_of(people["buyer"])


def test_founding_badge_only_for_first_providers(maker, monkeypatch):
    import common
    monkeypatch.setattr(common, "FOUNDING_PROVIDER_LIMIT", 2)
    import account
    monkeypatch.setattr(account, "FOUNDING_PROVIDER_LIMIT", 2)

    def test_db():
        session = maker()
        try:
            yield session
            session.commit()
        finally:
            session.close()
    app.dependency_overrides[deps.get_db] = test_db
    try:
        results = []
        for i in range(3):
            with maker() as db:
                db.add(User(id=f"u{i}", email=f"u{i}@example.com", display_name=f"u{i}"))
                db.flush()
                token = auth.create_session(db, f"u{i}")
                db.commit()
            client = TestClient(app, base_url=ORIGIN)
            client.cookies.set(auth.session_cookie_name(), token)
            results.append(client.put("/api/me/role", json={"role": "provider"}, headers=SAME).json())
        assert ["founding" in r["badges"] for r in results] == [True, True, False]
        # A buyer never becomes a founding provider.
        with maker() as db:
            db.add(User(id="b9", email="b9@example.com", display_name="b9"))
            db.flush()
            token = auth.create_session(db, "b9")
            db.commit()
        buyer = TestClient(app, base_url=ORIGIN)
        buyer.cookies.set(auth.session_cookie_name(), token)
        assert "founding" not in buyer.put("/api/me/role", json={"role": "buyer"}, headers=SAME).json()["badges"]
    finally:
        app.dependency_overrides.pop(deps.get_db, None)


def converse(people, maker, delays_minutes):
    """Buyer writes, provider replies; each buyer message is back-dated."""
    from models import Message
    buyer, prov = people["buyer"], people["prov"]
    first = buyer.post("/api/conversations", json={"listingId": "l-prov", "providerId": "prov",
                                                   "initialMessage": "Is this available?"}, headers=SAME)
    assert first.status_code == 201, first.text
    convo_id = first.json()["conversation"]["id"]
    for i, delay in enumerate(delays_minutes):
        if i:
            buyer.post(f"/api/conversations/{convo_id}/messages", json={"text": f"Follow-up {i}"}, headers=SAME)
        with maker() as db:  # shift the whole history back: buyer's latest message is `delay` old
            for message in db.query(Message).filter(Message.conversation_id == convo_id):
                created = message.created_at if message.created_at.tzinfo else message.created_at.replace(tzinfo=timezone.utc)
                message.created_at = created - timedelta(minutes=delay)
            db.commit()
        assert prov.post(f"/api/conversations/{convo_id}/messages", json={"text": "Yes!"},
                         headers=SAME).status_code == 201


def test_fast_responder_badge(people, maker):
    converse(people, maker, [5, 10])
    assert "fastResponder" not in badges_of(people["buyer"])  # needs 3 replies
    with maker() as db:
        assert db.get(User, "prov").response_samples == 2
    converse(people, maker, [15])  # same listing reuses the conversation: a 3rd reply
    with maker() as db:
        provider = db.get(User, "prov")
        assert provider.response_samples == 3 and 5 <= provider.avg_response_minutes <= 15
    assert "fastResponder" in badges_of(people["buyer"])


def test_slow_replies_do_not_earn_badge_and_provider_double_messages_ignored(people, maker):
    converse(people, maker, [180, 240, 300])
    assert "fastResponder" not in badges_of(people["buyer"])
    with maker() as db:
        samples = db.get(User, "prov").response_samples
    from models import Conversation
    with maker() as db:
        convo_id = db.query(Conversation).first().id
    people["prov"].post(f"/api/conversations/{convo_id}/messages", json={"text": "Also..."}, headers=SAME)
    with maker() as db:
        assert db.get(User, "prov").response_samples == samples  # not a reply to the buyer


# --- Refer a provider -------------------------------------------------------------

def signed_in(maker, user_id):
    with maker() as db:
        token = auth.create_session(db, user_id)
        db.commit()
    client = TestClient(app, base_url=ORIGIN)
    client.cookies.set(auth.session_cookie_name(), token)
    return client


def test_referral_credit_when_invitee_becomes_provider(people, maker):
    ref = people["prov"].get("/api/me/referral").json()
    assert len(ref["code"]) == 8 and ref["path"] == f"/sign-up?ref={ref['code']}"
    assert people["prov"].get("/api/me/referral").json()["code"] == ref["code"]  # stable
    with maker() as db:
        new, outcome = auth.find_or_create_user(db, "friend@example.com", ref["code"].lower())
        db.commit()
        assert outcome == "created" and new.referred_by == "prov"
        new_id = new.id
    friend = signed_in(maker, new_id)
    assert friend.put("/api/me/role", json={"role": "provider"}, headers=SAME).status_code == 200
    friend.put("/api/me/role", json={"role": "provider"}, headers=SAME)  # repeat: no double credit
    stats = people["prov"].get("/api/me/referral").json()
    assert stats["invited"] == 1 and stats["providers"] == 1 and stats["creditMonths"] == 1


def test_buyer_invitees_do_not_earn_credit(people, maker):
    code = people["prov"].get("/api/me/referral").json()["code"]
    with maker() as db:
        new, _ = auth.find_or_create_user(db, "buyer2@example.com", code)
        db.commit()
        new_id = new.id
    signed_in(maker, new_id).put("/api/me/role", json={"role": "buyer"}, headers=SAME)
    assert people["prov"].get("/api/me/referral").json()["creditMonths"] == 0


def test_existing_accounts_and_bad_codes_are_never_linked(people, maker):
    code = people["prov"].get("/api/me/referral").json()["code"]
    with maker() as db:
        existing, outcome = auth.find_or_create_user(db, "prov2@example.com", code)
        assert outcome == "existing" and existing.referred_by is None
        new, _ = auth.find_or_create_user(db, "x@example.com", "NOTACODE")
        assert new.referred_by is None
        db.commit()


def test_admin_referral_report_is_admin_only(people, maker):
    assert people["buyer"].get("/api/admin/referrals").status_code == 403
    with maker() as db:
        db.execute(update(User).where(User.id == "buyer").values(is_admin=True))
        db.execute(update(User).where(User.id == "prov").values(referral_credit_months=2))
        db.commit()
    items = people["buyer"].get("/api/admin/referrals").json()["items"]
    assert [(i["id"], i["creditMonths"]) for i in items] == [("prov", 2)]


# --- Seasonal banner -----------------------------------------------------------------

def test_banner_admin_create_and_time_window(people, maker):
    admin, buyer = people["prov2"], people["buyer"]
    with maker() as db:
        db.execute(update(User).where(User.id == "prov2").values(is_admin=True))
        db.commit()
    now = datetime.now(timezone.utc)
    body = {"message": "Diwali: rent party lights & speakers nearby!", "linkPath": "/categories/equipment",
            "startsAt": (now - timedelta(hours=1)).isoformat(), "endsAt": (now + timedelta(days=3)).isoformat()}
    assert buyer.post("/api/admin/banners", json=body, headers=SAME).status_code == 403
    created = admin.post("/api/admin/banners", json=body, headers=SAME)
    assert created.status_code == 201
    shown = buyer.get("/api/banner").json()["banner"]
    assert shown["message"].startswith("Diwali") and shown["linkPath"] == "/categories/equipment"
    future = dict(body, startsAt=(now + timedelta(days=1)).isoformat())
    admin.put(f"/api/admin/banners/{created.json()['id']}", json=future, headers=SAME)
    assert buyer.get("/api/banner").json()["banner"] is None  # not started yet
    off = dict(body, active=False)
    admin.put(f"/api/admin/banners/{created.json()['id']}", json=off, headers=SAME)
    assert buyer.get("/api/banner").json()["banner"] is None


@pytest.mark.parametrize("link", ["https://evil.example", "//evil.example", "/\\\\evil.example", "javascript:alert(1)"])
def test_banner_rejects_off_site_links(people, maker, link):
    with maker() as db:
        db.execute(update(User).where(User.id == "prov2").values(is_admin=True))
        db.commit()
    now = datetime.now(timezone.utc)
    body = {"message": "Hello", "linkPath": link, "startsAt": now.isoformat(),
            "endsAt": (now + timedelta(days=1)).isoformat()}
    assert people["prov2"].post("/api/admin/banners", json=body, headers=SAME).status_code == 422


# --- Share my trip ---------------------------------------------------------------------

@pytest.fixture
def trip(people, maker):
    from models import Booking
    with maker() as db:
        db.add(Listing(id="l-trip", provider_id="prov", category="travel", title="Blr to Mysore",
                       description="Daily shared cab ride", price=500, pricing_mode="fixed",
                       location_label="Bengaluru", latitude=12.97, longitude=77.59,
                       attributes={"vehicleType": "Sedan", "seatingCapacity": 4, "withDriver": True,
                                   "originLabel": "Bengaluru", "originLatitude": 12.97,
                                   "originLongitude": 77.59, "destinationLabel": "Mysuru",
                                   "destinationLatitude": 12.3, "destinationLongitude": 76.6,
                                   "departureAt": "2030-01-01T08:00:00+05:30", "availableSeats": 3}))
        db.add(Booking(id="b-trip", listing_id="l-trip", buyer_id="buyer", provider_id="prov",
                       category="travel", status="confirmed", details={"seats": 2, "note": "private"}))
        db.add(Booking(id="b-svc", listing_id="l-prov", buyer_id="buyer", provider_id="prov",
                       category="services", status="requested", details={}))
        db.execute(update(User).where(User.id == "prov").values(
            display_name="Ravi Kumar", phone="+919999999999", verification_status="verified"))
        db.commit()
    return people


def test_trip_share_link_is_public_minimal_and_revocable(trip, maker):
    buyer = trip["buyer"]
    created = buyer.post("/api/bookings/b-trip/share", headers=SAME)
    assert created.status_code == 200
    path = created.json()["path"]
    assert path.startswith("/trip/")
    anonymous = TestClient(app, base_url=ORIGIN)  # family member, not signed in
    shared = anonymous.get(f"/api/trips/shared/{path.rsplit('/', 1)[1]}")
    assert shared.status_code == 200 and shared.headers["cache-control"] == "no-store"
    body = shared.json()
    assert body["from"] == "Bengaluru" and body["to"] == "Mysuru" and body["status"] == "confirmed"
    assert body["driverFirstName"] == "Ravi" and body["driverVerified"] is True and body["seats"] == 2
    text = shared.text
    assert "9999999999" not in text and "@example.com" not in text and "Kumar" not in text
    assert "private" not in text and "b-trip" not in text and "prov" not in text
    assert buyer.delete("/api/bookings/b-trip/share", headers=SAME).status_code == 204
    assert anonymous.get(f"/api/trips/shared/{path.rsplit('/', 1)[1]}").status_code == 404


def test_trip_share_rules(trip, maker):
    from models import Booking
    assert trip["prov"].post("/api/bookings/b-trip/share", headers=SAME).status_code == 404  # traveller only
    assert trip["buyer"].post("/api/bookings/b-svc/share", headers=SAME).status_code == 422  # travel only
    assert trip["buyer"].post("/api/bookings/b-trip/share").status_code == 403              # CSRF
    first = trip["buyer"].post("/api/bookings/b-trip/share", headers=SAME).json()["path"].rsplit("/", 1)[1]
    second = trip["buyer"].post("/api/bookings/b-trip/share", headers=SAME).json()["path"].rsplit("/", 1)[1]
    anonymous = TestClient(app, base_url=ORIGIN)
    assert anonymous.get(f"/api/trips/shared/{first}").status_code == 404   # replaced
    assert anonymous.get(f"/api/trips/shared/{second}").status_code == 200
    with maker() as db:
        db.execute(update(Booking).where(Booking.id == "b-trip").values(
            share_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        db.commit()
    assert anonymous.get(f"/api/trips/shared/{second}").status_code == 404  # expired
    assert anonymous.get("/api/trips/shared/guess").status_code == 404
