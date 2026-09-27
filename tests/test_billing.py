"""Domain tests: no external sends, provider requests, or charges."""
import asyncio
import hashlib
import hmac
import json
import sys
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "artifacts/api-server/python"))
import billing as b
from billing_models import (BillingPlan, BillingDiscount, BillingSubscription,
                            BillingPayment, BillingWebhook, BillingSetting, now)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for table in (BillingPlan, BillingDiscount, BillingSubscription, BillingPayment, BillingWebhook, BillingSetting):
        table.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def subscription(db):
    s = BillingSubscription(user_id="user1", plan_id="plan1", provider_id="sub_test",
        snapshot={"name": "Paid", "amountPaise": 10000, "cycle": "monthly"}, status="created")
    db.add(s)
    db.commit()
    return s


@pytest.fixture
def provider(monkeypatch, subscription):
    end = int((now() + timedelta(days=30)).timestamp())
    responses = {
        "subscriptions/sub_test": {"id": "sub_test", "status": "active", "current_end": end},
        "payments/pay_test": {"id": "pay_test", "amount": 10000, "currency": "INR",
                              "status": "captured", "invoice_id": "inv_test"},
        "invoices/inv_test": {"subscription_id": "sub_test", "payment_id": "pay_test",
                             "status": "paid", "billing_end": end},
    }
    mock = Mock(side_effect=lambda method, path, payload=None: responses[path])
    monkeypatch.setattr(b, "provider", mock)
    return responses, mock


def test_credentials_fail_closed(monkeypatch):
    monkeypatch.setenv("RAZORPAY_TEST_KEY_ID", "rzp_live_never")
    monkeypatch.setenv("RAZORPAY_TEST_KEY_SECRET", "unit-test")
    with pytest.raises(HTTPException) as error:
        b.credentials()
    assert error.value.status_code == 503
    monkeypatch.setenv("RAZORPAY_TEST_KEY_ID", "rzp_test_example")
    assert b.credentials()[0] == "rzp_test_example"


def test_free_without_keys(db, monkeypatch):
    monkeypatch.delenv("RAZORPAY_TEST_KEY_ID", raising=False)
    assert not b.is_paid(db, "user1")
    assert b.free_contact_limit(db) == 5
    assert b.plans(db, SimpleNamespace(role="buyer"))["checkoutAvailable"] is False


def test_admin_guard():
    with pytest.raises(HTTPException) as error:
        b.admin(SimpleNamespace(is_admin=False))
    assert error.value.status_code == 403


@pytest.mark.parametrize("kind,value,expected", [("percentage", 25, 7500), ("flat", 3000, 7000)])
def test_recurring_discount(kind, value, expected):
    p = BillingPlan(id="p", amount_paise=10000)
    d = BillingDiscount(active=True, kind=kind, value=value, plan_ids=["p"],
        starts_at=now()-timedelta(days=1), ends_at=now()+timedelta(days=1), uses=0, max_uses=1)
    assert b.discount_amount(p, d, now()) == expected
    d.uses = 1
    with pytest.raises(HTTPException):
        b.discount_amount(p, d, now())


@pytest.mark.parametrize("change", [
    {"active": False}, {"plan_ids": ["other"]},
    {"ends_at": now()-timedelta(seconds=1)}, {"value": 100},
])
def test_discount_restrictions(change):
    p = BillingPlan(id="p", amount_paise=10000)
    values = dict(active=True, kind="percentage", value=10, plan_ids=["p"],
        starts_at=now()-timedelta(days=1), ends_at=now()+timedelta(days=1), uses=0, max_uses=1)
    values.update(change)
    with pytest.raises(HTTPException):
        b.discount_amount(p, BillingDiscount(**values), now())


def test_capture_deduplicated_and_old_invoice_cannot_extend(db, subscription, provider):
    responses, _ = provider
    b.reconcile(db, subscription, responses["subscriptions/sub_test"], "pay_test")
    db.commit()
    original = b.aware(subscription.current_period_end)
    responses["subscriptions/sub_test"]["current_end"] += 2592000
    b.reconcile(db, subscription, responses["subscriptions/sub_test"], "pay_test")
    db.commit()
    assert b.aware(subscription.current_period_end) == original
    assert len(list(db.scalars(select(BillingPayment)))) == 1
    assert b.is_paid(db, "user1")


@pytest.mark.parametrize("field,value", [("amount", 9999), ("currency", "USD")])
def test_payment_mismatch_denied(db, subscription, provider, field, value):
    responses, _ = provider
    responses["payments/pay_test"][field] = value
    with pytest.raises(HTTPException):
        b.reconcile(db, subscription, responses["subscriptions/sub_test"], "pay_test")
    assert not b.is_paid(db, "user1")


def test_wrong_invoice_denied(db, subscription, provider):
    responses, _ = provider
    responses["invoices/inv_test"]["subscription_id"] = "sub_other"
    with pytest.raises(HTTPException):
        b.reconcile(db, subscription, responses["subscriptions/sub_test"], "pay_test")


def test_failed_renewal_does_not_extend_paid_term(db, subscription, provider):
    responses, _ = provider
    subscription.current_period_end = now()-timedelta(seconds=1)
    responses["payments/pay_test"]["status"] = "failed"
    responses["subscriptions/sub_test"]["status"] = "pending"
    b.reconcile(db, subscription, responses["subscriptions/sub_test"], "pay_test")
    db.commit()
    assert not b.is_paid(db, "user1")
    assert db.get(BillingPayment, "pay_test").status == "failed"


def test_cancelled_keeps_only_paid_through(db, subscription):
    subscription.status = "cancelled"
    subscription.current_period_end = now()+timedelta(days=1)
    db.commit()
    assert b.is_paid(db, "user1")
    subscription.current_period_end = now()-timedelta(seconds=1)
    db.commit()
    assert not b.is_paid(db, "user1")


def test_invalid_checkout_signature(db, subscription, monkeypatch):
    monkeypatch.setattr(b, "credentials", lambda: ("rzp_test_example", "secret"))
    with pytest.raises(HTTPException) as error:
        b.verify(b.VerifyInput(subscriptionId=subscription.id, razorpayPaymentId="pay_test",
            razorpaySignature="0"*64), db, SimpleNamespace(id="user1"))
    assert error.value.status_code == 400


def webhook_request(event, event_id, signature=None):
    raw = json.dumps(event).encode()
    signature = signature or hmac.new(b"webhook-test", raw, hashlib.sha256).hexdigest()
    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}
    return Request({"type": "http", "headers": [
        (b"x-razorpay-event-id", event_id.encode()),
        (b"x-razorpay-signature", signature.encode())]}, receive)


def test_webhook_event_and_payment_idempotency(db, subscription, provider, monkeypatch):
    monkeypatch.setattr(b, "credentials", lambda: ("rzp_test_example", "secret"))
    monkeypatch.setenv("RAZORPAY_TEST_WEBHOOK_SECRET", "webhook-test")
    _, provider_mock = provider
    event = {"created_at": 20, "payload": {"subscription": {"entity": {"id": "sub_test"}},
                                        "payment": {"entity": {"id": "pay_test"}}}}
    for event_id in ("event1", "event1", "event2"):
        assert asyncio.run(b.webhook(webhook_request(event, event_id), db)) == {"received": True}
    assert len(list(db.scalars(select(BillingPayment)))) == 1
    assert len(list(db.scalars(select(BillingWebhook)))) == 2
    assert provider_mock.call_count == 6  # duplicate receipt skips all three provider reads
    event["created_at"] = 10
    event["payload"]["subscription"]["entity"]["status"] = "created"
    asyncio.run(b.webhook(webhook_request(event, "old_event"), db))
    assert subscription.status == "active"  # fetched state, not stale event snapshot
    assert subscription.last_event_at == 20


def test_webhook_receipts_and_subscription_lookup_are_mode_isolated(
        db, subscription, monkeypatch):
    live_subscription = BillingSubscription(
        user_id="user1", plan_id="plan1", provider_id="live:sub_test",
        snapshot={"name": "Paid", "amountPaise": 10000, "cycle": "monthly",
                  "razorpayMode": "live"},
        status="created")
    db.add(live_subscription)
    db.commit()

    monkeypatch.setattr(b, "credentials", lambda: ("rzp_live_example", "live-secret"))
    monkeypatch.setenv("RAZORPAY_MODE", "live")
    monkeypatch.setenv("RAZORPAY_LIVE_WEBHOOK_SECRET", "webhook-test")
    monkeypatch.setattr(b, "provider", Mock(return_value={"id": "sub_test", "status": "active"}))
    event = {"created_at": 30, "payload": {
        "subscription": {"entity": {"id": "sub_test", "status": "halted"}}}}

    asyncio.run(b.webhook(webhook_request(event, "same-event"), db))
    assert live_subscription.status == "active"
    assert subscription.status == "created"
    assert db.get(BillingWebhook, "live:same-event") is not None
    assert db.get(BillingWebhook, "same-event") is None

    # The same provider event identifier in test mode is a distinct receipt.
    monkeypatch.setenv("RAZORPAY_MODE", "test")
    monkeypatch.setenv("RAZORPAY_TEST_WEBHOOK_SECRET", "webhook-test")
    monkeypatch.setattr(b, "credentials", lambda: ("rzp_test_example", "test-secret"))
    asyncio.run(b.webhook(webhook_request(event, "same-event"), db))
    assert subscription.status == "active"
    assert db.get(BillingWebhook, "same-event") is not None
    assert len(list(db.scalars(select(BillingWebhook)))) == 2


def test_webhook_signature_rejected(db, monkeypatch):
    monkeypatch.setattr(b, "credentials", lambda: ("rzp_test_example", "secret"))
    monkeypatch.setenv("RAZORPAY_TEST_WEBHOOK_SECRET", "webhook-test")
    with pytest.raises(HTTPException) as error:
        asyncio.run(b.webhook(webhook_request({}, "event1", "bad"), db))
    assert error.value.status_code == 400


def test_webhook_rejects_missing_event_id_before_provider_or_database_changes(
        db, subscription, provider, monkeypatch):
    monkeypatch.setattr(b, "credentials", lambda: ("rzp_test_example", "secret"))
    monkeypatch.setenv("RAZORPAY_TEST_WEBHOOK_SECRET", "webhook-test")
    event = {"payload": {"subscription": {"entity": {"id": "sub_test"}}}}
    request = webhook_request(event, "unused")
    request = Request({"type": "http", "headers": [
        (b"x-razorpay-signature",
         hmac.new(b"webhook-test", json.dumps(event).encode(), hashlib.sha256).hexdigest().encode())
    ]}, request.receive)
    _, provider_mock = provider
    with pytest.raises(HTTPException) as error:
        asyncio.run(b.webhook(request, db))
    assert error.value.status_code == 400
    assert provider_mock.call_count == 0
    assert not list(db.scalars(select(BillingWebhook)))


@pytest.mark.parametrize(("method", "path", "payload"), [
    ("GET", "/admin/billing/plans", None),
    ("POST", "/admin/billing/plans",
     {"name": "Plan", "role": "buyer", "cycle": "monthly", "amountPaise": 100}),
    ("PUT", "/admin/billing/plans/plan-id",
     {"name": "Plan", "role": "buyer", "cycle": "monthly", "amountPaise": 100}),
    ("GET", "/admin/billing/discounts", None),
    ("POST", "/admin/billing/discounts",
     {"code": "TEST10", "kind": "percentage", "value": 10, "planIds": ["plan-id"],
      "startsAt": "2030-01-01T00:00:00Z", "endsAt": "2031-01-01T00:00:00Z",
      "maxUses": 1}),
    ("PUT", "/admin/billing/discounts/discount-id",
     {"code": "TEST10", "kind": "percentage", "value": 10, "planIds": ["plan-id"],
      "startsAt": "2030-01-01T00:00:00Z", "endsAt": "2031-01-01T00:00:00Z",
      "maxUses": 1}),
    ("GET", "/admin/billing/settings", None),
    ("PUT", "/admin/billing/settings", {"freeContactLimit": 10}),
    ("GET", "/admin/billing/revenue", None),
])
def test_all_admin_billing_routes_deny_non_admin_before_database_access(
        method, path, payload):
    app = FastAPI()
    app.include_router(b.router)
    app.dependency_overrides[b.current_user] = lambda: SimpleNamespace(
        id="not-admin", role="buyer", is_admin=False)

    class UnusedDatabase:
        def __getattr__(self, name):
            raise AssertionError(f"non-admin reached database operation: {name}")

    app.dependency_overrides[b.get_db] = lambda: UnusedDatabase()
    with TestClient(app) as client:
        response = client.request(method, path, json=payload)
    assert response.status_code == 403
    assert response.json()["detail"] == "Administrator access required"


def test_admin_billing_route_requires_authenticated_user():
    app = FastAPI()
    app.include_router(b.router)

    def unauthenticated():
        raise HTTPException(401, "Authentication required")

    app.dependency_overrides[b.current_user] = unauthenticated
    with TestClient(app) as client:
        response = client.get("/admin/billing/settings")
    assert response.status_code == 401


def test_schedule_upgrade_without_immediate_charge(db, subscription, monkeypatch):
    subscription.status = "active"
    subscription.current_period_end = now()+timedelta(days=15)
    p = BillingPlan(id="upgrade", name="Upgrade", role="buyer", cycle="monthly",
                    amount_paise=20000, active=True)
    db.add(p)
    db.commit()
    mock = Mock(side_effect=[{"id": "plan_remote"}, {"id": "sub_test", "status": "active"}])
    monkeypatch.setattr(b, "provider", mock)
    result = b.change_plan(b.ChangePlanInput(subscriptionId=subscription.id, planId=p.id),
                          db, SimpleNamespace(id="user1", role="buyer"))
    assert result["subscription"]["amountPaise"] == 10000
    assert result["subscription"]["scheduledChange"]["amountPaise"] == 20000
    assert mock.call_args.args[0] == "PATCH"
    assert mock.call_args.args[2]["schedule_change_at"] == "cycle_end"
    assert not list(db.scalars(select(BillingPayment)))


def test_scheduled_plan_applies_only_when_next_invoice_paid(db, subscription, provider):
    responses, _ = provider
    effective = int(now().timestamp())
    subscription.pending_snapshot = {"id": "upgrade", "name": "Upgrade", "cycle": "monthly",
                                     "amountPaise": 20000, "effectiveAt": effective}
    responses["payments/pay_test"]["amount"] = 20000
    responses["invoices/inv_test"]["billing_start"] = effective
    b.reconcile(db, subscription, responses["subscriptions/sub_test"], "pay_test")
    db.commit()
    assert subscription.plan_id == "upgrade"
    assert subscription.snapshot["amountPaise"] == 20000
    assert subscription.pending_snapshot is None