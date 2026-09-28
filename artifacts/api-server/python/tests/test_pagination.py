import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

HERE = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, HERE)

from interactions import conversations, notifications
from models import Base, Conversation, Notification, User, Verification
from pagination import decode_cursor
from verification import admin_verifications


@pytest.fixture()
def db():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def make_user(index, role="buyer"):
    return User(
        id=f"00000000-0000-0000-0000-{index:012d}",
        google_sub=f"cursor_user_{index}",
        email=f"cursor{index}@example.com",
        display_name=f"Cursor {index}",
        role=role,
    )


def test_notification_pages_have_stable_boundaries_and_are_private(db):
    owner, other = make_user(1), make_user(2)
    db.add_all([owner, other])
    same_time = datetime(2030, 1, 1, tzinfo=timezone.utc)
    for index in range(5):
        db.add(Notification(
            id=f"10000000-0000-0000-0000-{index:012d}",
            user_id=owner.id, type="message", title=str(index), body="body",
            created_at=same_time if index < 3 else same_time - timedelta(seconds=index),
        ))
    db.add(Notification(
        id="20000000-0000-0000-0000-000000000001",
        user_id=other.id, type="message", title="private", body="private",
        created_at=same_time + timedelta(days=1),
    ))
    db.commit()

    seen = []
    cursor = None
    while True:
        page = notifications(cursor=cursor, limit=2, db=db, user=owner)
        seen.extend(item["id"] for item in page["items"])
        cursor = page["nextCursor"]
        if cursor is None:
            break

    assert len(seen) == 5
    assert len(set(seen)) == 5
    assert "20000000-0000-0000-0000-000000000001" not in seen


def test_admin_verification_filter_starts_an_independent_cursor_chain(db):
    users = [make_user(index + 10) for index in range(5)]
    db.add_all(users)
    submitted = datetime(2030, 2, 1, tzinfo=timezone.utc)
    for index, user in enumerate(users):
        db.add(Verification(
            id=f"30000000-0000-0000-0000-{index:012d}",
            user_id=user.id,
            legal_name=user.display_name,
            id_type="passport",
            id_media_id=f"40000000-0000-0000-0000-{index:012d}",
            status="pending" if index < 3 else "rejected",
            submitted_at=submitted,
        ))
    db.commit()
    admin = type("Admin", (), {"is_admin": True})()

    first = admin_verifications(status="pending", cursor=None, limit=2, db=db, admin=admin)
    second = admin_verifications(
        status="pending", cursor=first["nextCursor"], limit=2, db=db, admin=admin)
    reset = admin_verifications(status="rejected", cursor=None, limit=2, db=db, admin=admin)

    pending = first["items"] + second["items"]
    assert len(pending) == 3
    assert len({item["id"] for item in pending}) == 3
    assert {item["status"] for item in pending} == {"pending"}
    assert len(reset["items"]) == 2
    assert {item["status"] for item in reset["items"]} == {"rejected"}
    assert reset["nextCursor"] is None


def test_conversations_page_only_contains_participant_rows(db):
    buyer, provider, outsider = make_user(30), make_user(31, "provider"), make_user(32)
    db.add_all([buyer, provider, outsider])
    at = datetime(2030, 3, 1, tzinfo=timezone.utc)
    for index in range(3):
        db.add(Conversation(
            id=f"50000000-0000-0000-0000-{index:012d}",
            listing_id=f"60000000-0000-0000-0000-{index:012d}",
            buyer_id=buyer.id,
            provider_id=provider.id,
            last_message_at=at - timedelta(minutes=index),
            created_at=at - timedelta(minutes=index),
        ))
    db.add(Conversation(
        id="70000000-0000-0000-0000-000000000001",
        listing_id="80000000-0000-0000-0000-000000000001",
        buyer_id=outsider.id,
        provider_id=provider.id,
        last_message_at=at + timedelta(days=1),
        created_at=at,
    ))
    db.commit()

    first = conversations(cursor=None, limit=2, db=db, user=buyer)
    second = conversations(cursor=first["nextCursor"], limit=2, db=db, user=buyer)
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(ids) == 3
    assert len(set(ids)) == 3
    assert "70000000-0000-0000-0000-000000000001" not in ids


def test_malformed_cursor_is_rejected():
    with pytest.raises(HTTPException) as error:
        decode_cursor("not-a-valid-cursor")
    assert error.value.status_code == 422