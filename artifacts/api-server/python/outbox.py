"""Retryable notification email outbox, shared by the API worker and CLI."""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from deps import SessionLocal
from models import NotificationOutbox

RESEND_URL = os.getenv("RESEND_API_URL", "https://api.resend.com/emails")
logger = logging.getLogger("pontreol.notifications")


class EmailError(Exception):
    """Safe, secret-free delivery failure description."""


def resend_configured():
    return bool(os.getenv("RESEND_FROM", "").strip() and os.getenv("RESEND_API_KEY", "").strip())


def send_via_resend(message, client=None):
    """POST one email to Resend. Returns the provider id; raises EmailError.
    Never includes the API key, recipient or body in errors or logs."""
    key = os.getenv("RESEND_API_KEY", "").strip()
    if not key:
        raise EmailError("RESEND_API_KEY is not configured")
    request = dict(headers={"Authorization": f"Bearer {key}",
                            "Idempotency-Key": message["idempotencyKey"]},
                   json={"from": message["from"], "to": [message["to"]],
                         "subject": message["subject"], "text": message["text"]},
                   timeout=15)
    try:
        response = (client.post(RESEND_URL, **request) if client is not None
                    else httpx.post(RESEND_URL, **request))
    except httpx.HTTPError as exc:
        raise EmailError(f"Email provider unreachable: {type(exc).__name__}") from exc
    if response.status_code >= 400:
        raise EmailError(f"Email provider rejected the notification (HTTP {response.status_code})")
    try:
        provider_id = response.json().get("id")
    except ValueError as exc:
        raise EmailError("Email provider returned an invalid response") from exc
    if not provider_id:
        raise EmailError("Email provider returned no message id")
    return provider_id


async def run_worker(stop: asyncio.Event):
    """Skip-locked rows permit multiple API processes without duplicate delivery."""
    def batch():
        if SessionLocal is not None:
            with SessionLocal.begin() as session:
                process_batch(session, limit=5)

    if not resend_configured():
        logger.warning("Notification email disabled: set RESEND_FROM and RESEND_API_KEY; "
                       "notifications stay queued")
    while not stop.is_set():
        if resend_configured():
            try:
                await asyncio.to_thread(batch)
            except Exception:
                # Never include DB parameters, recipients, or message contents.
                logger.warning("Notification batch failed; delivery remains queued")
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            pass


def process_batch(db, limit=25, sender=send_via_resend):
    from_address = os.getenv("RESEND_FROM", "").strip()
    if not from_address:
        # Domain/sender is not ready: preserve queued records without consuming
        # attempts or pretending delivery succeeded.
        return {"processed": 0, "sent": 0, "skipped": "RESEND_FROM is not configured"}
    if not os.getenv("RESEND_API_KEY", "").strip():
        return {"processed": 0, "sent": 0, "skipped": "RESEND_API_KEY is not configured"}
    records = list(db.scalars(select(NotificationOutbox).where(
        NotificationOutbox.sent_at.is_(None),
        NotificationOutbox.attempts < 10).order_by(
            NotificationOutbox.created_at).with_for_update(skip_locked=True).limit(limit)))
    sent = 0
    for item in records:
        message = {"from": from_address, "to": item.recipient, "subject": item.subject,
                   "text": item.body, "idempotencyKey": item.id}
        try:
            sender(message)
            item.sent_at, item.last_error = datetime.now(timezone.utc), None
            sent += 1
        except EmailError as exc:
            item.attempts += 1
            item.last_error = str(exc)[:1000]
        except Exception as exc:  # never let one message stop the batch
            item.attempts += 1
            item.last_error = f"Email delivery failed: {type(exc).__name__}"
    db.flush()
    if len(records) - sent:
        logger.warning("Notification batch: %d sent, %d failed and remain queued",
                       sent, len(records) - sent)
    return {"processed": len(records), "sent": sent}


if __name__ == "__main__":
    if SessionLocal is None:
        raise SystemExit("DATABASE_URL is not configured")
    with SessionLocal.begin() as session:
        result = process_batch(session)
    print(json.dumps(result))