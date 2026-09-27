import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import billing


def subscription(mode=None, **values):
    snapshot = {"name": "Plan", "amountPaise": 100, "cycle": "monthly"}
    if mode:
        snapshot["razorpayMode"] = mode
    defaults = dict(id="sub-local", user_id="user-1", snapshot=snapshot,
                    status="active", current_period_end=None)
    defaults.update(values)
    return SimpleNamespace(**defaults)


def test_mode_defaults_to_test_and_legacy_records_are_test(monkeypatch):
    monkeypatch.delenv("RAZORPAY_MODE", raising=False)
    assert billing.billing_mode() == "test"
    assert billing.subscription_mode(subscription()) == "test"
    assert billing.subscription_mode(subscription("live")) == "live"


def test_invalid_mode_and_wrong_key_prefix_fail_closed(monkeypatch):
    monkeypatch.setenv("RAZORPAY_MODE", "production")
    with pytest.raises(HTTPException) as invalid:
        billing.billing_mode()
    assert invalid.value.status_code == 503

    monkeypatch.setenv("RAZORPAY_MODE", "live")
    monkeypatch.setenv("RAZORPAY_LIVE_KEY_ID", "rzp_test_wrong")
    monkeypatch.setenv("RAZORPAY_LIVE_KEY_SECRET", "secret")
    with pytest.raises(HTTPException) as wrong_prefix:
        billing.credentials()
    assert wrong_prefix.value.status_code == 503


def test_live_checkout_requires_distinct_webhook_configuration(monkeypatch):
    monkeypatch.setenv("RAZORPAY_MODE", "live")
    monkeypatch.setenv("RAZORPAY_LIVE_KEY_ID", "rzp_live_valid")
    monkeypatch.setenv("RAZORPAY_LIVE_KEY_SECRET", "secret")
    monkeypatch.delenv("RAZORPAY_LIVE_WEBHOOK_SECRET", raising=False)
    with pytest.raises(HTTPException) as missing:
        billing.credentials(require_webhook=True)
    assert missing.value.status_code == 503
    assert "webhook" in missing.value.detail.lower()


def test_payment_and_webhook_receipts_are_namespaced_between_modes():
    assert billing.payment_storage_id("test", "pay_same") == "pay_same"
    assert billing.payment_storage_id("live", "pay_same") == "live:pay_same"
    assert billing.webhook_storage_id("test", "evt_same") == "evt_same"
    assert billing.webhook_storage_id("live", "evt_same") == "live:evt_same"
    assert billing.subscription_storage_id("test", "sub_same") == "sub_same"
    assert billing.subscription_storage_id("live", "sub_same") == "live:sub_same"


def test_owned_subscription_rejects_cross_mode_record(monkeypatch):
    monkeypatch.setenv("RAZORPAY_MODE", "live")
    db = SimpleNamespace(scalar=lambda _statement: subscription("test"))
    with pytest.raises(HTTPException) as denied:
        billing.owned_subscription(db, SimpleNamespace(id="user-1"), "sub-local")
    assert denied.value.status_code == 404


def test_paid_access_uses_only_current_mode(monkeypatch):
    monkeypatch.setenv("RAZORPAY_MODE", "live")
    db = SimpleNamespace(scalars=lambda _statement: [
        subscription("test"),
        subscription("live"),
    ])
    assert billing.is_paid(db, "user-1") is True
    db.scalars = lambda _statement: [subscription("test")]
    assert billing.is_paid(db, "user-1") is False