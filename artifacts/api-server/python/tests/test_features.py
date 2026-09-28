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
