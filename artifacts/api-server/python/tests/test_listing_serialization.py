"""Listing reads use an isolated in-memory database, never the application DB."""
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from common import listing_json, listings_json
from listings import home, mine, search
from models import Listing, ListingMedia, Media, User


@pytest.fixture
def data():
    engine = create_engine("sqlite://")
    for model in (User, Listing, Media, ListingMedia):
        model.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as db:
        a = User(id="provider-a", google_sub="google-a", email="a@example.com",
                 display_name="A", role="provider")
        b = User(id="provider-b", google_sub="google-b", email="b@example.com",
                 display_name="B", role="provider")
        db.add_all((a, b))
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        for i in range(120):
            listing = Listing(id=f"listing-{i:03}", provider_id=a.id if i % 2 == 0 else b.id,
                              category="services" if i % 2 == 0 else "spaces",
                              title=f"Item {i}", description="Test listing", price=float(i),
                              pricing_mode="fixed", location_label="Local", latitude=0,
                              longitude=0, attributes={}, status="paused" if i == 119 else "active",
                              created_at=start + timedelta(minutes=i))
            db.add(listing)
            if i < 5:
                for position in (0, 1):
                    media = Media(id=f"photo-{i}-{position}", owner_id=listing.provider_id,
                                  purpose="listingPhoto", object_path=f"test/{i}/{position}",
                                  content_type="image/png", size_bytes=10, status="ready")
                    db.add(media)
                    db.add(ListingMedia(listing_id=listing.id, media_id=media.id,
                                        position=position))
        db.commit()
        yield db, engine, a, b
    engine.dispose()


@contextmanager
def queries(engine):
    statements = []

    def record(_conn, _cursor, statement, _params, _context, _executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def search_items(db, **kwargs):
    args = dict(db=db, user=SimpleNamespace(id="buyer"), category=None, search=None,
                priceMin=None, priceMax=None, lat=None, lng=None, distanceKm=25,
                sort="relevance", limit=30, originLat=None, originLng=None,
                destinationLat=None, destinationLng=None, departureFrom=None,
                departureTo=None, seats=None)
    args.update(kwargs)
    return search(**args)


def test_batch_payload_and_empty_query(data):
    db, engine, _, _ = data
    rows = list(db.scalars(select(Listing).order_by(Listing.id).limit(5)))
    expected = [listing_json(db, row, float(i)) for i, row in enumerate(rows)]
    with queries(engine) as sql:
        actual = listings_json(db, ((row, float(i)) for i, row in enumerate(rows)))
    assert actual == expected
    assert len(sql) == 2
    assert [photo["id"] for photo in actual[0]["photos"]] == ["photo-0-0", "photo-0-1"]
    with queries(engine) as sql:
        assert listings_json(db, []) == []
    assert not sql


def test_search_limits_filters_order_and_constant_queries(data):
    db, engine, _, _ = data
    with queries(engine) as sql:
        result = search_items(db, category="services", sort="priceHigh", limit=5)
    assert len(sql) == 3
    assert [x["price"] for x in result["items"]] == [118, 116, 114, 112, 110]
    assert result["nextCursor"] is None
    with queries(engine) as sql:
        filtered = search_items(db, search="Item 1", priceMin=110, priceMax=115,
                                lat=0, lng=0, limit=100)
    assert len(sql) == 3
    assert [x["price"] for x in filtered["items"]] == [110, 111, 112, 113, 114, 115]
    assert all(x["distanceKm"] == 0 for x in filtered["items"])
    with queries(engine) as sql:
        assert search_items(db, search="does-not-exist")["items"] == []
    assert len(sql) == 1


def test_mine_excludes_other_provider_and_archived(data):
    db, engine, a, _ = data
    archived = db.get(Listing, "listing-000")
    archived.status = "archived"
    db.flush()
    with queries(engine) as sql:
        result = mine(db=db, user=a)
    assert len(sql) == 3
    assert len(result["items"]) == 59
    assert result["items"][0]["id"] == "listing-118"
    assert result["items"][-1]["id"] == "listing-002"
    assert all(x["providerId"] == a.id for x in result["items"])


def test_home_counts_all_active_but_serializes_first_hundred_only(data):
    db, engine, _, _ = data
    with queries(engine) as sql:
        result = home(db=db, user=SimpleNamespace(id="buyer"))
    assert len(sql) == 4
    assert result["totalListings"] == 119
    assert result["categories"] == [
        {"category": "delivery", "count": 0},
        {"category": "services", "count": 60}, {"category": "spaces", "count": 59},
        {"category": "travel", "count": 0},
    ]
    assert len(result["nearbyListings"]) == 100
    assert result["nearbyListings"][0]["id"] == "listing-000"
    assert all(x["id"] != "listing-119" for x in result["nearbyListings"])
    assert "GROUP BY" in sql[0].upper()
    assert "LIMIT" in sql[1].upper()
    with queries(engine) as sql:
        far = home(db=db, user=SimpleNamespace(id="buyer"), lat=60, lng=60)
    assert len(sql) == 2  # No provider/media lookups when nothing is nearby.
    assert far["totalListings"] == 119
    assert far["nearbyListings"] == []