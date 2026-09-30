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
    svc = trip["buyer"].post("/api/bookings/b-svc/share", headers=SAME)          # service jobs too
    assert svc.status_code == 200
    job = TestClient(app, base_url=ORIGIN).get(f"/api/trips/shared/{svc.json()['path'].rsplit('/', 1)[1]}").json()
    assert job["category"] == "services" and job["from"] is None and job["to"] is None
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


# --- Moving house bundle (frontend sends ordinary bookings; verify the contract) -----

def test_moving_bundle_payloads_are_accepted(people, maker):
    with maker() as db:
        db.add(Listing(id="l-tempo", provider_id="prov2", category="delivery", title="Tata Ace tempo",
                       description="Local house shifting tempo", price=1500, pricing_mode="negotiable",
                       location_label="Koramangala", latitude=12.93, longitude=77.62,
                       attributes={"vehicleType": "Tata Ace", "maxLoadCapacity": 750, "serviceRadiusKm": 30}))
        db.commit()
    when = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    frm = {"label": "Koramangala, Bengaluru", "latitude": 12.93, "longitude": 77.62}
    to = {"label": "Indiranagar, Bengaluru", "latitude": 12.97, "longitude": 77.64}
    buyer = people["buyer"]
    delivery = buyer.post("/api/bookings/delivery", headers=SAME, json={
        "listingId": "l-tempo", "pickupAt": when, "itemDescription": "1BHK: bed, fridge, 15 boxes",
        "note": "Moving house bundle.", "pickup": frm, "dropoff": to})
    helper = buyer.post("/api/bookings/services", headers=SAME, json={
        "listingId": "l-prov", "requestedAt": when,
        "note": "Moving house bundle: Koramangala → Indiranagar. Items: 1BHK."})
    assert delivery.status_code == 201, delivery.text
    assert helper.status_code == 201, helper.text
    mine = buyer.get("/api/bookings").json()["items"]
    assert {b["category"] for b in mine} == {"delivery", "services"}


# --- Delivery: From -> To search -------------------------------------------------------

def test_delivery_search_requires_service_area_to_cover_from_and_to(people, maker):
    with maker() as db:
        # Koramangala tempo covering 15 km; Whitefield bike covering 5 km.
        db.add(Listing(id="d-wide", provider_id="prov", category="delivery", title="Tempo 15km",
                       description="Local house shifting", price=900, pricing_mode="fixed",
                       location_label="Koramangala", latitude=12.935, longitude=77.624,
                       attributes={"vehicleType": "Tempo", "maxLoadCapacity": 750, "serviceRadiusKm": 15}))
        db.add(Listing(id="d-small", provider_id="prov2", category="delivery", title="Bike 5km",
                       description="Small parcel delivery", price=100, pricing_mode="fixed",
                       location_label="Whitefield", latitude=12.969, longitude=77.750,
                       attributes={"vehicleType": "Bike", "maxLoadCapacity": 10, "serviceRadiusKm": 5}))
        db.commit()
    buyer = people["buyer"]

    def ids(**params):
        query = "&".join(f"{k}={v}" for k, v in {"category": "delivery", **params}.items())
        response = buyer.get(f"/api/listings?{query}")
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()["items"]]

    # Koramangala -> Indiranagar (both within 15 km of the tempo; far from the bike)
    assert ids(pickupLat=12.935, pickupLng=77.62, dropoffLat=12.97, dropoffLng=77.64) == ["d-wide"]
    # Whitefield -> nearby Whitefield (bike covers it; tempo 15 km radius also reaches ~13 km)
    near_wf = ids(pickupLat=12.97, pickupLng=77.745, dropoffLat=12.975, dropoffLng=77.73, sort="distance")
    assert near_wf[0] == "d-small"
    # Koramangala -> Mysuru (140 km): nobody covers the drop-off
    assert ids(pickupLat=12.935, pickupLng=77.62, dropoffLat=12.30, dropoffLng=76.64) == []
    # Distance is reported from the pickup point
    first = buyer.get("/api/listings?category=delivery&pickupLat=12.935&pickupLng=77.624"
                      "&dropoffLat=12.97&dropoffLng=77.64&sort=distance").json()["items"][0]
    assert first["id"] == "d-wide" and first["distanceKm"] < 0.5


def test_delivery_listing_with_route_matches_from_origin_to_destination(people, maker):
    prov, buyer = people["prov"], people["buyer"]
    base = {"category": "delivery", "title": "Bengaluru to Mysuru", "description": "Daily parcel run to Mysuru",
            "price": 500, "pricingMode": "fixed", "locationLabel": "Koramangala",
            "latitude": 12.935, "longitude": 77.624}
    attrs = {"vehicleType": "Van", "maxLoadCapacity": 300, "serviceRadiusKm": 10}
    route = {"originLabel": "Koramangala", "originLatitude": 12.935, "originLongitude": 77.624,
             "destinationLabel": "Mysuru", "destinationLatitude": 12.30, "destinationLongitude": 76.64}
    # Partial routes and bad coordinates are rejected; no route stays valid.
    assert prov.post("/api/listings", json={**base, "attributes": {**attrs, "originLabel": "x"}}, headers=SAME).status_code == 422
    assert prov.post("/api/listings", json={**base, "attributes": {**attrs, **route, "originLatitude": 99}}, headers=SAME).status_code == 422
    created = prov.post("/api/listings", json={**base, "attributes": {**attrs, **route}}, headers=SAME)
    assert created.status_code in (200, 201), created.text
    listing_id = created.json()["id"]
    if created.json()["status"] != "active":
        with maker() as db:
            db.get(Listing, listing_id).status = "active"
            db.commit()

    def ids(**params):
        query = "&".join(f"{k}={v}" for k, v in {"category": "delivery", **params}.items())
        return [x["id"] for x in buyer.get(f"/api/listings?{query}").json()["items"]]

    # Koramangala -> Mysuru matches the route (Mysuru is far outside the 10 km radius)
    assert listing_id in ids(pickupLat=12.94, pickupLng=77.62, dropoffLat=12.31, dropoffLng=76.65)
    # Reverse direction and off-route drop-off do not match
    assert listing_id not in ids(pickupLat=12.31, pickupLng=76.65, dropoffLat=12.94, dropoffLng=77.62)
    assert listing_id not in ids(pickupLat=12.94, pickupLng=77.62, dropoffLat=13.34, dropoffLng=77.10)
    # Editing can remove the route
    patched = prov.patch(f"/api/listings/{listing_id}", json={"attributes": attrs}, headers=SAME)
    assert patched.status_code == 200


def test_search_available_now_filter(people, maker):
    with maker() as db:
        for lid, pid in (("free", "prov"), ("busy", "prov2")):
            db.add(Listing(id=lid, provider_id=pid, category="services", title=lid,
                           description="Plumbing and repairs", price=300, pricing_mode="fixed",
                           location_label="x", latitude=12.9, longitude=77.6,
                           attributes={"serviceType": "Plumber", "experienceYears": 3, "onSiteOrRemote": "onSite"}))
        db.commit()
    assert people["prov"].put("/api/me/availability", json={"available": True, "hours": 4},
                              headers=SAME).status_code == 200
    items = people["buyer"].get("/api/listings?availableNow=true").json()["items"]
    ids = {x["id"] for x in items}
    assert "free" in ids and "busy" not in ids
    assert all(x["providerId"] == "prov" for x in items)
    assert {x["id"] for x in people["buyer"].get("/api/listings").json()["items"]} >= {"free", "busy"}


def test_review_photos_must_be_own_ready_review_photos(people, maker):
    from models import Booking, Media
    done = datetime.now(timezone.utc)
    with maker() as db:
        db.add(Booking(id="b-done", listing_id="l-prov", buyer_id="buyer", provider_id="prov",
                       category="services", status="completed", details={},
                       buyer_completed_at=done, provider_completed_at=done))
        db.add(Media(id="m-mine", owner_id="buyer", purpose="reviewPhoto", object_path="p/1.jpg",
                     content_type="image/jpeg", size_bytes=10, status="ready"))
        db.add(Media(id="m-other", owner_id="prov2", purpose="reviewPhoto", object_path="p/2.jpg",
                     content_type="image/jpeg", size_bytes=10, status="ready"))
        db.commit()
    buyer = people["buyer"]
    bad = buyer.post("/api/bookings/b-done/reviews", headers=SAME,
                     json={"rating": 5, "comment": "Great", "photoIds": ["m-other"]})
    assert bad.status_code == 422
    ok = buyer.post("/api/bookings/b-done/reviews", headers=SAME,
                    json={"rating": 5, "comment": "Great work", "photoIds": ["m-mine"]})
    assert ok.status_code == 201 and ok.json()["photoIds"] == ["m-mine"]
    profile = buyer.get("/api/providers/prov").json()
    assert profile["reviews"][0]["photoUrls"] == ["/api/media/m-mine"]


def test_last_minute_deal_and_earnings(people, maker):
    from models import Booking
    prov, buyer = people["prov"], people["buyer"]
    assert prov.put("/api/listings/l-prov/deal", json={"percent": 90, "hours": 2}, headers=SAME).status_code == 422
    assert people["prov2"].put("/api/listings/l-prov/deal", json={"percent": 20, "hours": 2}, headers=SAME).status_code == 404
    deal = prov.put("/api/listings/l-prov/deal", json={"percent": 20, "hours": 6}, headers=SAME)
    assert deal.status_code == 200 and deal.json()["dealPercent"] == 20
    assert deal.json()["dealPrice"] == round(deal.json()["price"] * 0.8)
    assert [x["id"] for x in buyer.get("/api/listings?deals=true").json()["items"]] == ["l-prov"]
    assert prov.delete("/api/listings/l-prov/deal", headers=SAME).status_code == 204
    assert buyer.get("/api/listings?deals=true").json()["items"] == []

    now = datetime.now(timezone.utc)
    with maker() as db:
        db.add(Booking(id="e1", listing_id="l-prov", buyer_id="buyer", provider_id="prov", category="services",
                       status="completed", details={}, quoted_price=1200, provider_completed_at=now))
        db.add(Booking(id="e2", listing_id="l-prov", buyer_id="buyer", provider_id="prov", category="services",
                       status="completed", details={}, provider_completed_at=now))
        db.add(Booking(id="e3", listing_id="l-prov", buyer_id="buyer", provider_id="prov", category="services",
                       status="confirmed", details={}, quoted_price=999))
        db.commit()
    summary = prov.get("/api/me/earnings").json()
    listing_price = buyer.get("/api/listings/l-prov").json()["price"]
    assert summary["thisMonth"] == {"jobs": 2, "amount": round(1200 + listing_price)}
    assert buyer.get("/api/me/earnings").status_code == 403
