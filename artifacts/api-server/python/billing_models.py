"""Billing tables; registered with shared metadata, never created at startup."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String
from models import Base


def uid():
    return str(uuid.uuid4())


def now():
    return datetime.now(timezone.utc)


class BillingPlan(Base):
    __tablename__ = "billing_plans"
    id = Column(String, primary_key=True, default=uid)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)
    cycle = Column(String, nullable=False)
    amount_paise = Column(Integer, nullable=False)
    active = Column(Boolean, nullable=False, default=True)


class BillingDiscount(Base):
    __tablename__ = "billing_discounts"
    id = Column(String, primary_key=True, default=uid)
    code = Column(String, nullable=False, unique=True)
    kind = Column(String, nullable=False)
    value = Column(Integer, nullable=False)
    plan_ids = Column(JSON, nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    max_uses = Column(Integer, nullable=False)
    uses = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)


class BillingSubscription(Base):
    __tablename__ = "billing_subscriptions"
    id = Column(String, primary_key=True, default=uid)
    user_id = Column(String, nullable=False, index=True)
    plan_id = Column(String, nullable=False)
    snapshot = Column(JSON, nullable=False)
    pending_snapshot = Column(JSON)
    provider_id = Column(String, unique=True)
    status = Column(String, nullable=False, default="created")
    current_period_end = Column(DateTime(timezone=True))
    cancel_at_period_end = Column(Boolean, nullable=False, default=False)
    discount_id = Column(String)
    last_event_at = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)


class BillingPayment(Base):
    __tablename__ = "billing_payments"
    id = Column(String, primary_key=True)  # provider payment id
    subscription_id = Column(String, nullable=False, index=True)
    amount_paise = Column(Integer, nullable=False)
    currency = Column(String, nullable=False)
    status = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class BillingWebhook(Base):
    __tablename__ = "billing_webhooks"
    id = Column(String, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class BillingSetting(Base):
    __tablename__ = "billing_settings"
    id = Column(String, primary_key=True)
    value = Column(Integer, nullable=False)