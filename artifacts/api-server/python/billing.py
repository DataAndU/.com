"""Mode-isolated Razorpay subscriptions. Test mode is the safe default."""
import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import User
from deps import current_user, get_db
from billing_models import (BillingPlan, BillingDiscount, BillingSubscription,
                            BillingPayment, BillingWebhook, BillingSetting, now)

router = APIRouter()


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def billing_mode():
    mode = os.getenv("RAZORPAY_MODE", "test").strip().lower()
    if mode not in ("test", "live"):
        raise HTTPException(503, "RAZORPAY_MODE must be explicitly set to test or live")
    return mode


def subscription_mode(subscription):
    """Legacy, untagged snapshots predate live support and are always test data."""
    return subscription.snapshot.get("razorpayMode", "test")


def payment_storage_id(mode, provider_id):
    # Preserve legacy test keys; namespace live IDs because Razorpay environments
    # can generate the same opaque IDs independently.
    return provider_id if mode == "test" else f"live:{provider_id}"


def subscription_storage_id(mode, provider_id):
    return provider_id if mode == "test" else f"live:{provider_id}"


def subscription_provider_id(subscription):
    return subscription.provider_id.removeprefix("live:") if subscription.provider_id else None


def webhook_storage_id(mode, event_id):
    return event_id if mode == "test" else f"live:{event_id}"


def credentials(require_webhook=False):
    mode = billing_mode()
    prefix = "RAZORPAY_LIVE" if mode == "live" else "RAZORPAY_TEST"
    key = os.getenv(prefix + "_KEY_ID", "")
    secret = os.getenv(prefix + "_KEY_SECRET", "")
    webhook_secret = os.getenv(prefix + "_WEBHOOK_SECRET", "")
    expected_prefix = "rzp_live_" if mode == "live" else "rzp_test_"
    if not key.startswith(expected_prefix) or not secret:
        raise HTTPException(424, f"Razorpay {mode.upper()} credentials are not configured correctly. Free access remains available.")
    if require_webhook and not webhook_secret:
        raise HTTPException(424, f"Razorpay {mode.upper()} webhook secret must be configured before checkout")
    return key, secret


def provider(method, path, payload=None):
    key, secret = credentials()
    try:
        response = httpx.request(method, "https://api.razorpay.com/v1/" + path,
                                auth=(key, secret), json=payload, timeout=20)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, f"Razorpay {billing_mode()} service could not complete the request. Check billing status before retrying.")


def admin(user=Depends(current_user)):
    if not user.is_admin:
        raise HTTPException(403, "Administrator access required")
    return user


def free_contact_limit(db):
    setting = db.get(BillingSetting, "free_contact_limit")
    return setting.value if setting else 5


def is_paid(db, user_id):
    mode = billing_mode()
    records = db.scalars(select(BillingSubscription).where(
        BillingSubscription.user_id == str(user_id),
        BillingSubscription.current_period_end > now(),
        BillingSubscription.status.in_(["active", "pending", "halted", "cancelled", "completed"])
    ))
    return any(subscription_mode(s) == mode for s in records)


def plan_json(p):
    return dict(id=p.id, name=p.name, role=p.role, cycle=p.cycle,
                amountPaise=p.amount_paise, currency="INR", active=p.active)


def subscription_json(s):
    if not s:
        return None
    return dict(id=s.id, planId=s.plan_id, planName=s.snapshot["name"],
                amountPaise=s.snapshot["amountPaise"], currency="INR",
                cycle=s.snapshot["cycle"], status=s.status,
                currentPeriodEnd=aware(s.current_period_end).isoformat() if s.current_period_end else None,
                cancelAtPeriodEnd=s.cancel_at_period_end, razorpaySubscriptionId=subscription_provider_id(s),
                scheduledChange=({"planId": s.pending_snapshot["id"], "planName": s.pending_snapshot["name"],
                    "amountPaise": s.pending_snapshot["amountPaise"],
                    "effectiveAt": datetime.fromtimestamp(s.pending_snapshot["effectiveAt"], timezone.utc).isoformat()}
                    if s.pending_snapshot else None))


def payment_json(p):
    provider_id = p.id.removeprefix("live:")
    return dict(id=provider_id, subscriptionId=p.subscription_id, amountPaise=p.amount_paise,
                currency=p.currency, status=p.status, createdAt=aware(p.created_at).isoformat())


class PlanInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    role: Literal["buyer", "provider"]
    cycle: Literal["monthly", "yearly"]
    amountPaise: int = Field(ge=100, le=100000000, strict=True)
    active: bool = True


class DiscountInput(BaseModel):
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{2,40}$")
    kind: Literal["percentage", "flat"]
    value: int = Field(ge=1, strict=True)
    planIds: list[str] = Field(min_length=1)
    startsAt: datetime
    endsAt: datetime
    maxUses: int = Field(ge=1, strict=True)
    active: bool = True

    @model_validator(mode="after")
    def valid(self):
        if self.startsAt.tzinfo is None or self.endsAt.tzinfo is None or self.endsAt <= self.startsAt:
            raise ValueError("Valid timezone-aware start/end dates required")
        if self.kind == "percentage" and self.value > 100:
            raise ValueError("Percentage cannot exceed 100")
        return self


class SubscribeInput(BaseModel):
    planId: str
    discountCode: str | None = None


class SubscriptionInput(BaseModel):
    subscriptionId: str


class VerifyInput(SubscriptionInput):
    razorpayPaymentId: str = Field(pattern=r"^pay_[A-Za-z0-9]+$")
    razorpaySignature: str = Field(pattern=r"^[a-f0-9]{64}$")


class ChangePlanInput(SubscriptionInput):
    planId: str


class SettingsInput(BaseModel):
    freeContactLimit: int = Field(ge=0, le=100000, strict=True)


def discount_amount(plan, discount, at):
    if (not discount.active or plan.id not in discount.plan_ids
            or not aware(discount.starts_at) <= at < aware(discount.ends_at)
            or discount.uses >= discount.max_uses):
        raise HTTPException(422, "Discount is expired, exhausted, inactive or not applicable")
    reduction = (plan.amount_paise * discount.value // 100
                 if discount.kind == "percentage" else discount.value)
    amount = plan.amount_paise - reduction
    if amount < 100:
        raise HTTPException(422, "Recurring discounted installments must be at least 100 paise")
    return amount


@router.get("/billing/plans")
def plans(db: Session = Depends(get_db), user=Depends(current_user)):
    # 424 (not 503) above: App Platform replaces 503 bodies with its own page.
    available, problem = True, None
    try:
        credentials(require_webhook=billing_mode() == "live")
    except HTTPException as exc:
        available, problem = False, exc.detail
    return dict(plans=[plan_json(p) for p in db.scalars(select(BillingPlan).where(
        BillingPlan.active.is_(True), BillingPlan.role == user.role))],
        testMode=billing_mode() == "test", checkoutAvailable=available, checkoutProblem=problem)


@router.get("/billing/status")
def status(db: Session = Depends(get_db), user=Depends(current_user)):
    mode = billing_mode()
    records = db.scalars(select(BillingSubscription).where(BillingSubscription.user_id == str(user.id))
                         .order_by(BillingSubscription.created_at.desc()))
    s = next((item for item in records if subscription_mode(item) == mode), None)
    return dict(paid=is_paid(db, user.id), freeContactLimit=free_contact_limit(db),
                subscription=subscription_json(s), testMode=mode == "test")


@router.post("/billing/subscribe")
def subscribe(body: SubscribeInput, db: Session = Depends(get_db), user=Depends(current_user)):
    mode = billing_mode()
    key, _ = credentials(require_webhook=mode == "live")
    # Serialize all subscription creations for this verified user.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    existing = [s for s in db.scalars(select(BillingSubscription).where(
        BillingSubscription.user_id == str(user.id))) if subscription_mode(s) == mode]
    if any(s.status in ("creating", "creation_unknown", "created", "authenticated", "active", "pending", "halted")
           or (s.current_period_end and aware(s.current_period_end) > now()) for s in existing):
        raise HTTPException(409, "Cancel the existing subscription and wait until its paid term ends before changing plans. Proration is not supported.")
    p = db.scalar(select(BillingPlan).where(BillingPlan.id == body.planId).with_for_update())
    if not p or not p.active or p.role != user.role:
        raise HTTPException(422, "Active plan for your role required")
    amount, discount = p.amount_paise, None
    if body.discountCode:
        discount = db.scalar(select(BillingDiscount).where(
            BillingDiscount.code == body.discountCode.upper()).with_for_update())
        if not discount:
            raise HTTPException(422, "Unknown discount")
        amount = discount_amount(p, discount, now())
    snapshot = plan_json(p)
    snapshot["amountPaise"] = amount
    snapshot["razorpayMode"] = mode
    # Dedicated immutable provider plan implements the same discount on EVERY installment.
    remote_plan = provider("POST", "plans", dict(period=p.cycle, interval=1,
        item=dict(name=p.name, amount=amount, currency="INR")))
    s = BillingSubscription(user_id=str(user.id), plan_id=p.id, snapshot=snapshot, status="creating",
                            discount_id=discount.id if discount else None)
    db.add(s)
    db.flush()
    if discount:
        discount.uses += 1
    # Persist intent before the non-idempotent remote call. A timeout must not
    # cause an automatic second subscription on retry.
    db.commit()
    try:
        remote = provider("POST", "subscriptions", dict(plan_id=remote_plan["id"],
            total_count=120 if p.cycle == "monthly" else 10, quantity=1,
            customer_notify=1, notes={"pontreol_subscription_id": s.id,
                                      "pontreol_razorpay_mode": mode}))
    except HTTPException:
        s = db.scalar(select(BillingSubscription).where(BillingSubscription.id == s.id).with_for_update())
        if not s.provider_id:
            s.status = "creation_unknown"
        db.commit()
        raise
    s = db.scalar(select(BillingSubscription).where(BillingSubscription.id == s.id).with_for_update())
    s.provider_id = subscription_storage_id(mode, remote["id"])
    if s.status in ("creating", "creation_unknown"):
        s.status = remote["status"]
    db.commit()
    return dict(subscription=subscription_json(s), checkout=dict(keyId=key,
        subscriptionId=subscription_provider_id(s), name="Pontreol", description=p.name), testMode=mode == "test")


def owned_subscription(db, user, subscription_id):
    s = db.scalar(select(BillingSubscription).where(
        BillingSubscription.id == subscription_id).with_for_update())
    if not s or s.user_id != str(user.id) or subscription_mode(s) != billing_mode():
        raise HTTPException(404, "Subscription not found")
    return s


def reconcile(db, s, remote, payment_id=None):
    """Fetch-authoritative state avoids applying stale webhook snapshots."""
    mode = billing_mode()
    if subscription_mode(s) != mode:
        raise HTTPException(422, "Subscription belongs to another Razorpay mode")
    remote_subscription_id = subscription_provider_id(s)
    if remote.get("id") != remote_subscription_id:
        raise HTTPException(422, "Subscription identity mismatch")
    if payment_id:
        if not re.fullmatch(r"pay_[A-Za-z0-9]+", payment_id):
            raise HTTPException(422, "Invalid payment ID")
        payment = provider("GET", "payments/" + payment_id)
        invoice_id = payment.get("invoice_id")
        if not invoice_id:
            raise HTTPException(422, "Subscription invoice is required")
        invoice = provider("GET", "invoices/" + invoice_id)
        applying_change = bool(s.pending_snapshot and
            (invoice.get("billing_start") or 0) >= s.pending_snapshot["effectiveAt"])
        expected_snapshot = s.pending_snapshot if applying_change else s.snapshot
        storage_id = payment_storage_id(mode, payment_id)
        record = db.get(BillingPayment, storage_id)
        expected_amount = record.amount_paise if record else expected_snapshot["amountPaise"]
        if (invoice.get("subscription_id") != remote_subscription_id or
                invoice.get("payment_id") != payment_id or
                payment.get("amount") != expected_amount or
                payment.get("currency") != "INR"):
            raise HTTPException(422, "Payment invoice, amount or currency mismatch")
        state = payment.get("status")
        if state not in ("captured", "failed", "authorized"):
            raise HTTPException(422, "Unsupported payment state")
        if record and record.subscription_id != s.id:
            raise HTTPException(422, "Payment already belongs to another subscription")
        if not record:
            record = BillingPayment(id=storage_id, subscription_id=s.id,
                amount_paise=payment["amount"], currency="INR", status=state)
            db.add(record)
        elif record.status != "captured":
            record.status = state
        if state == "captured":
            # Never extend from remote.current_end: a redelivered OLD payment
            # could otherwise grant a later, unpaid renewal period.
            if not invoice.get("billing_end") or invoice.get("status") != "paid":
                raise HTTPException(422, "Captured recurring payment requires a paid invoice with billing period")
            end = datetime.fromtimestamp(invoice["billing_end"], timezone.utc)
            if not s.current_period_end or end > aware(s.current_period_end):
                s.current_period_end = end
            if applying_change:
                s.plan_id = s.pending_snapshot["id"]
                s.snapshot = s.pending_snapshot
                s.pending_snapshot = None
    state = remote.get("status")
    if state not in ("created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "expired"):
        raise HTTPException(422, "Unsupported subscription state")
    s.status = state
    if state == "cancelled":
        s.cancel_at_period_end = True


@router.post("/billing/verify")
def verify(body: VerifyInput, db: Session = Depends(get_db), user=Depends(current_user)):
    _, secret = credentials()
    s = owned_subscription(db, user, body.subscriptionId)
    remote_id = subscription_provider_id(s)
    expected = hmac.new(secret.encode(), f"{body.razorpayPaymentId}|{remote_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpaySignature):
        raise HTTPException(400, "Invalid checkout signature")
    reconcile(db, s, provider("GET", "subscriptions/" + remote_id), body.razorpayPaymentId)
    db.commit()
    return {"subscription": subscription_json(s)}


@router.post("/billing/cancel")
def cancel(body: SubscriptionInput, db: Session = Depends(get_db), user=Depends(current_user)):
    s = owned_subscription(db, user, body.subscriptionId)
    if not s.provider_id:
        raise HTTPException(409, "Subscription creation is awaiting provider reconciliation. Do not retry checkout; contact support.")
    if not s.cancel_at_period_end and s.status not in ("cancelled", "completed", "expired"):
        remote = provider("POST", "subscriptions/" + subscription_provider_id(s) + "/cancel",
                          {"cancel_at_cycle_end": 1 if s.current_period_end else 0})
        reconcile(db, s, remote)
        s.cancel_at_period_end = True
        db.commit()
    return {"subscription": subscription_json(s)}


@router.post("/billing/change-plan")
def change_plan(body: ChangePlanInput, db: Session = Depends(get_db), user=Depends(current_user)):
    s = owned_subscription(db, user, body.subscriptionId)
    if s.status != "active" or s.cancel_at_period_end or not s.current_period_end:
        raise HTTPException(409, "Only active, non-cancelling subscriptions can change plans")
    if s.pending_snapshot:
        raise HTTPException(409, "A plan change is already scheduled")
    p = db.scalar(select(BillingPlan).where(BillingPlan.id == body.planId).with_for_update())
    if not p or not p.active or p.role != user.role or p.id == s.plan_id:
        raise HTTPException(422, "Choose another active plan for your role")
    if p.cycle != s.snapshot["cycle"]:
        raise HTTPException(422, "Cycle changes require cancellation and a new subscription after the paid term. Same-cycle upgrades and downgrades can be scheduled.")
    remote_plan = provider("POST", "plans", dict(period=p.cycle, interval=1,
        item=dict(name=p.name, amount=p.amount_paise, currency="INR")))
    snapshot = plan_json(p)
    snapshot["effectiveAt"] = int(aware(s.current_period_end).timestamp())
    snapshot["razorpayMode"] = billing_mode()
    # Persist intent before the external operation so an ambiguous timeout does
    # not allow competing changes. Admin/provider reconciliation may be needed.
    s.pending_snapshot = snapshot
    db.commit()
    provider("PATCH", "subscriptions/" + subscription_provider_id(s), {
        "plan_id": remote_plan["id"], "schedule_change_at": "cycle_end", "customer_notify": 1})
    return {"subscription": subscription_json(s)}


@router.get("/billing/payments")
def payments(db: Session = Depends(get_db), user=Depends(current_user)):
    mode = billing_mode()
    records = db.scalars(select(BillingPayment).join(BillingSubscription,
        BillingPayment.subscription_id == BillingSubscription.id).where(
            BillingSubscription.user_id == str(user.id)).order_by(BillingPayment.created_at.desc()))
    subscriptions = {s.id: s for s in db.scalars(select(BillingSubscription).where(
        BillingSubscription.user_id == str(user.id)))}
    return {"payments": [payment_json(p) for p in records
                         if subscription_mode(subscriptions[p.subscription_id]) == mode]}


@router.post("/billing/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    credentials()
    mode = billing_mode()
    prefix = "RAZORPAY_LIVE" if mode == "live" else "RAZORPAY_TEST"
    secret = os.getenv(prefix + "_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, f"Razorpay {mode.upper()} webhook secret is not configured")
    raw = await request.body()
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("x-razorpay-signature", "")):
        raise HTTPException(400, "Invalid webhook signature")
    event_id = request.headers.get("x-razorpay-event-id")
    if not event_id or len(event_id) > 255:
        raise HTTPException(400, "Webhook event ID required")
    try:
        event = json.loads(raw)
        entity = event.get("payload", {}).get("subscription", {}).get("entity", {})
        payment = event.get("payload", {}).get("payment", {}).get("entity", {})
    except (ValueError, AttributeError):
        raise HTTPException(400, "Invalid webhook body")
    # Payment-only events are superseded by subscription.charged/pending events.
    if not entity.get("id"):
        return {"received": True}
    stored_provider_id = subscription_storage_id(mode, entity["id"])
    s = db.scalar(select(BillingSubscription).where(
        BillingSubscription.provider_id == stored_provider_id).with_for_update())
    if s and subscription_mode(s) != mode:
        raise HTTPException(409, "Subscription belongs to another Razorpay mode")
    if not s and entity.get("notes", {}).get("pontreol_subscription_id"):
        note_mode = entity.get("notes", {}).get("pontreol_razorpay_mode", "test")
        if note_mode != mode:
            raise HTTPException(409, "Webhook notes belong to another Razorpay mode")
        s = db.scalar(select(BillingSubscription).where(
            BillingSubscription.id == entity["notes"]["pontreol_subscription_id"]).with_for_update())
        if s and subscription_mode(s) != mode:
            raise HTTPException(409, "Webhook notes reference another Razorpay mode")
        if s and s.provider_id is None:
            s.provider_id = stored_provider_id
    if not s:
        raise HTTPException(409, "Subscription not yet registered; retry webhook")
    receipt_id = webhook_storage_id(mode, event_id)
    if db.get(BillingWebhook, receipt_id):
        return {"received": True}
    remote = provider("GET", "subscriptions/" + subscription_provider_id(s))
    reconcile(db, s, remote, payment.get("id"))
    s.last_event_at = max(s.last_event_at, int(event.get("created_at", 0)))
    db.add(BillingWebhook(id=receipt_id))
    db.commit()
    return {"received": True}


@router.get("/admin/billing/plans")
def admin_plans(db: Session = Depends(get_db), user=Depends(admin)):
    return {"plans": [plan_json(p) for p in db.scalars(select(BillingPlan))]}


def save_plan(body, db, plan_id=None):
    p = db.get(BillingPlan, plan_id) if plan_id else BillingPlan()
    if not p:
        raise HTTPException(404, "Plan not found")
    p.name, p.role, p.cycle = body.name, body.role, body.cycle
    p.amount_paise, p.active = body.amountPaise, body.active
    db.add(p)
    db.commit()
    return plan_json(p)


@router.post("/admin/billing/plans")
def create_plan(body: PlanInput, db: Session = Depends(get_db), user=Depends(admin)):
    return save_plan(body, db)


@router.put("/admin/billing/plans/{plan_id}")
def update_plan(plan_id: str, body: PlanInput, db: Session = Depends(get_db), user=Depends(admin)):
    return save_plan(body, db, plan_id)


def discount_json(d):
    return dict(id=d.id, code=d.code, kind=d.kind, value=d.value, planIds=d.plan_ids,
        startsAt=aware(d.starts_at).isoformat(), endsAt=aware(d.ends_at).isoformat(),
        maxUses=d.max_uses, uses=d.uses, active=d.active)


@router.get("/admin/billing/discounts")
def discounts(db: Session = Depends(get_db), user=Depends(admin)):
    return {"discounts": [discount_json(d) for d in db.scalars(select(BillingDiscount))]}


def save_discount(body, db, discount_id=None):
    d = db.scalar(select(BillingDiscount).where(BillingDiscount.id == discount_id).with_for_update()) if discount_id else BillingDiscount(uses=0)
    if not d:
        raise HTTPException(404, "Discount not found")
    duplicate = db.scalar(select(BillingDiscount).where(BillingDiscount.code == body.code.upper()))
    if duplicate and duplicate.id != d.id:
        raise HTTPException(409, "Discount code already exists")
    if body.maxUses < d.uses:
        raise HTTPException(422, "Usage limit cannot be below already reserved uses")
    if any(not db.get(BillingPlan, pid) for pid in body.planIds):
        raise HTTPException(422, "Unknown applicable plan")
    d.code, d.kind, d.value = body.code.upper(), body.kind, body.value
    d.plan_ids, d.starts_at, d.ends_at = body.planIds, body.startsAt, body.endsAt
    d.max_uses, d.active = body.maxUses, body.active
    db.add(d)
    db.commit()
    return discount_json(d)


@router.post("/admin/billing/discounts")
def create_discount(body: DiscountInput, db: Session = Depends(get_db), user=Depends(admin)):
    return save_discount(body, db)


@router.put("/admin/billing/discounts/{discount_id}")
def update_discount(discount_id: str, body: DiscountInput, db: Session = Depends(get_db), user=Depends(admin)):
    return save_discount(body, db, discount_id)


@router.get("/admin/billing/settings")
def settings(db: Session = Depends(get_db), user=Depends(admin)):
    return {"freeContactLimit": free_contact_limit(db)}


@router.put("/admin/billing/settings")
def set_settings(body: SettingsInput, db: Session = Depends(get_db), user=Depends(admin)):
    db.merge(BillingSetting(id="free_contact_limit", value=body.freeContactLimit))
    db.commit()
    return body.model_dump()


@router.get("/admin/billing/revenue")
def revenue(db: Session = Depends(get_db), user=Depends(admin)):
    mode = billing_mode()
    subscriptions = [s for s in db.scalars(select(BillingSubscription))
                     if subscription_mode(s) == mode]
    subscription_ids = {s.id for s in subscriptions}
    records = [p for p in db.scalars(select(BillingPayment).order_by(BillingPayment.created_at.desc()))
               if p.subscription_id in subscription_ids]
    return dict(currency="INR", testMode=mode == "test",
        totalCapturedPaise=sum(p.amount_paise for p in records if p.status == "captured"),
        payments=[payment_json(p) for p in records],
        subscriptions=[subscription_json(s) for s in subscriptions])