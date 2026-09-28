"""Milestone tests against isolated real PostgreSQL schema."""
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import Depends, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

HERE = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, HERE)

import billing_models  # noqa: F401
from app import app
from deps import current_user, get_db
from models import Base, ContactUsage, Listing, Media, NotificationOutbox, User
from outbox import EmailError, process_batch
from billing_models import BillingSetting


def pg_url():
    value = os.environ["DATABASE_URL"]
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]
    if value.startswith("postgresql://") and "+psycopg" not in value:
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    return value


@pytest.fixture(scope="module")
def database():
    schema = "test_pontreol_" + uuid.uuid4().hex
    root = create_engine(pg_url(), pool_pre_ping=True)
    with root.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = root.execution_options(schema_translate_map={None: schema})
    Base.metadata.create_all(isolated)
    maker = sessionmaker(isolated, expire_on_commit=False)
    yield maker
    isolated.dispose()
    with root.begin() as connection:
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    root.dispose()


@pytest.fixture()
def api(database):
    def test_db():
        session = database()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def test_user(request: Request, db: Session = Depends(get_db)):
        user = db.get(User, request.headers["x-test-user"])
        assert user is not None
        return user

    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[current_user] = test_user
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def users(database):
    with database.begin() as db:
        buyer = User(google_sub="buyer_" + uuid.uuid4().hex,
            email=f"{uuid.uuid4().hex}@example.com", display_name="Buyer", role="buyer")
        provider = User(google_sub="provider_" + uuid.uuid4().hex,
            email=f"{uuid.uuid4().hex}@example.com", display_name="Provider", role="provider")
        other = User(google_sub="other_" + uuid.uuid4().hex,
            email=f"{uuid.uuid4().hex}@example.com", display_name="Other", role="buyer")
        db.add_all([buyer, provider, other])
    return buyer, provider, other


ATTRS = {
    "services": {"serviceType": "repair", "experienceYears": 4, "onSiteOrRemote": "onSite"},
    "spaces": {"capacity": 10, "spaceType": "studio"},
    "equipment": {"equipmentType": "excavator", "condition": "good", "fuelType": "diesel"},
    "delivery": {"vehicleType": "van", "maxLoadCapacity": 500, "serviceRadiusKm": 40},
    "travel": {"vehicleType": "car", "seatingCapacity": 1, "withDriver": True,
        "originLabel": "A", "originLatitude": 12.9, "originLongitude": 77.5,
        "destinationLabel": "B", "destinationLatitude": 13.0, "destinationLongitude": 77.6,
        "departureAt": "2030-01-01T10:00:00+00:00", "availableSeats": 1},
}


def listing(database, provider, category, status="active", pricing="fixed"):
    with database.begin() as db:
        item = Listing(provider_id=provider.id, category=category, title=f"{category} listing",
            description="A sufficiently detailed real test listing", price=100,
            pricing_mode=pricing, currency="INR", location_label="Test location",
            latitude=12.9, longitude=77.5, status=status, attributes=ATTRS[category])
        db.add(item)
    return item


def auth(user):
    return {"x-test-user": user.id}


def put_availability(api, provider, item, start, end):
    response = api.put(f"/api/listings/{item.id}/availability", headers=auth(provider),
        json={"timezone": "UTC", "slots": [{"startsAt": start.isoformat(), "endsAt": end.isoformat()}]})
    assert response.status_code == 200, response.text


def test_categories_in_required_order(api, database):
    buyer, provider, _ = users(database)
    start = datetime(2030, 1, 2, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)

    service = listing(database, provider, "services")
    response = api.post("/api/bookings/services", headers=auth(buyer),
        json={"listingId": service.id, "requestedAt": start.isoformat()})
    assert response.status_code == 201 and response.json()["status"] == "confirmed"

    space = listing(database, provider, "spaces")
    put_availability(api, provider, space, start, end)
    response = api.post("/api/bookings/spaces", headers=auth(buyer),
        json={"listingId": space.id, "mode": "hourly",
              "checkIn": start.isoformat(), "checkOut": end.isoformat()})
    assert response.status_code == 201

    equipment = listing(database, provider, "equipment")
    put_availability(api, provider, equipment, start, end)
    response = api.post("/api/bookings/equipment", headers=auth(buyer),
        json={"listingId": equipment.id, "startsAt": start.isoformat(),
              "endsAt": end.isoformat(), "operatorRequested": True})
    assert response.status_code == 201

    delivery = listing(database, provider, "delivery")
    response = api.post("/api/bookings/delivery", headers=auth(buyer), json={
        "listingId": delivery.id, "pickup": {"label": "A", "latitude": 12.9, "longitude": 77.5},
        "dropoff": {"label": "B", "latitude": 13.0, "longitude": 77.6},
        "pickupAt": start.isoformat(), "itemDescription": "Box"})
    assert response.status_code == 201

    travel = listing(database, provider, "travel")
    response = api.post("/api/bookings/travel", headers=auth(buyer),
        json={"listingId": travel.id, "seats": 1})
    assert response.status_code == 201


@pytest.mark.parametrize("category,path,body", [
    ("spaces", "/api/bookings/spaces", {"mode": "hourly", "checkIn": None, "checkOut": None}),
    ("equipment", "/api/bookings/equipment", {"startsAt": None, "endsAt": None, "operatorRequested": False}),
])
def test_overlap_race_allows_one(api, database, category, path, body):
    buyer, provider, other = users(database)
    item = listing(database, provider, category)
    start = datetime(2031, 1, 1, 10, tzinfo=timezone.utc)
    end = start + timedelta(hours=2)
    put_availability(api, provider, item, start, end)
    payload = dict(body, listingId=item.id)
    for key in ("checkIn", "startsAt"): 
        if key in payload: payload[key] = start.isoformat()
    for key in ("checkOut", "endsAt"):
        if key in payload: payload[key] = end.isoformat()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda user: api.post(path, headers=auth(user), json=payload).status_code,
                                [buyer, other]))
    assert sorted(results) == [201, 409]


def test_travel_oversell_race_allows_one(api, database):
    buyer, provider, other = users(database)
    item = listing(database, provider, "travel")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda user: api.post("/api/bookings/travel",
            headers=auth(user), json={"listingId": item.id, "seats": 1}).status_code,
            [buyer, other]))
    assert sorted(results) == [201, 409]


def test_contact_same_and_distinct_races_are_atomic(api, database):
    buyer, provider, distinct_buyer = users(database)
    first, second = listing(database, provider, "services"), listing(database, provider, "services")
    with database.begin() as db:
        db.merge(BillingSetting(id="free_contact_limit", value=1))
    with ThreadPoolExecutor(max_workers=2) as pool:
        same = list(pool.map(lambda _: api.post(f"/api/listings/{first.id}/contact",
            headers=auth(buyer), json={}).status_code, range(2)))
    assert same == [200, 200]
    with database() as db:
        assert len(list(db.scalars(select(ContactUsage).where(ContactUsage.buyer_id == buyer.id)))) == 1
    assert api.post(f"/api/listings/{second.id}/contact", headers=auth(buyer), json={}).status_code == 402
    with ThreadPoolExecutor(max_workers=2) as pool:
        distinct = list(pool.map(lambda item: api.post(f"/api/listings/{item.id}/contact",
            headers=auth(distinct_buyer), json={}).status_code, [first, second]))
    assert sorted(distinct) == [200, 402]
    with database() as db:
        assert len(list(db.scalars(select(ContactUsage).where(
            ContactUsage.buyer_id == distinct_buyer.id)))) == 1


def test_mutual_completion_review_private_media_and_paused_booking(api, database):
    buyer, provider, other = users(database)
    item = listing(database, provider, "services")
    start = datetime(2032, 1, 1, 10, tzinfo=timezone.utc)
    booking = api.post("/api/bookings/services", headers=auth(buyer),
        json={"listingId": item.id, "requestedAt": start.isoformat()}).json()
    assert api.post(f"/api/bookings/{booking['id']}/complete", headers=auth(buyer), json={}).status_code == 200
    assert api.post(f"/api/bookings/{booking['id']}/reviews", headers=auth(buyer),
        json={"rating": 5, "comment": "Great"}).status_code == 409
    assert api.post(f"/api/bookings/{booking['id']}/complete", headers=auth(provider), json={}).status_code == 200
    assert api.post(f"/api/bookings/{booking['id']}/reviews", headers=auth(buyer),
        json={"rating": 5, "comment": "Great"}).status_code == 201

    with database.begin() as db:
        private = Media(owner_id=provider.id, purpose="verificationId",
            object_path="private/id.jpg", content_type="image/jpeg",
            size_bytes=100, status="ready", is_private=True)
        db.add(private)
    assert api.get(f"/api/media/{private.id}", headers=auth(other)).status_code == 404

    paused = listing(database, provider, "services", status="paused")
    assert api.post("/api/bookings/services", headers=auth(buyer),
        json={"listingId": paused.id, "requestedAt": start.isoformat()}).status_code == 404
    assert api.delete(f"/api/listings/{item.id}", headers=auth(provider)).status_code == 204
    assert api.post("/api/bookings/services", headers=auth(other),
        json={"listingId": item.id, "requestedAt": start.isoformat()}).status_code == 404


def test_outbox_skips_without_sender_and_retries(database, monkeypatch):
    buyer, _, _ = users(database)
    with database.begin() as db:
        db.query(NotificationOutbox).delete()
        item = NotificationOutbox(user_id=buyer.id, recipient=buyer.email,
            subject="Booking update", body="Your booking changed")
        db.add(item)
    monkeypatch.delenv("RESEND_FROM", raising=False)
    with database.begin() as db:
        assert process_batch(db)["skipped"] == "RESEND_FROM is not configured"
        queued = db.get(NotificationOutbox, item.id)
        assert queued.attempts == 0 and queued.sent_at is None

    monkeypatch.setenv("RESEND_FROM", "Pontreol <notifications@pontreol.com>")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with database.begin() as db:
        assert process_batch(db)["skipped"] == "RESEND_API_KEY is not configured"
        assert db.get(NotificationOutbox, item.id).attempts == 0

    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")

    def failed(_message):
        raise EmailError("Email provider rejected the notification (HTTP 422)")
    with database.begin() as db:
        assert process_batch(db, sender=failed) == {"processed": 1, "sent": 0}
        assert db.get(NotificationOutbox, item.id).attempts == 1

    succeeded = lambda _message: "email_1"
    with database.begin() as db:
        assert process_batch(db, sender=succeeded) == {"processed": 1, "sent": 1}
        assert db.get(NotificationOutbox, item.id).sent_at is not None