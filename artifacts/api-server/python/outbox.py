"""Retryable notification email outbox, shared by the API worker and CLI."""
import asyncio
import json
import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from deps import SessionLocal
from models import NotificationOutbox

BRIDGE = Path(__file__).resolve().parent.parent / "resend-send.mjs"
logger = logging.getLogger("pontreol.notifications")


async def run_worker(stop: asyncio.Event):
    """Skip-locked rows permit multiple API processes without duplicate delivery."""
    def batch():
        if SessionLocal is not None:
            with SessionLocal.begin() as session:
                process_batch(session, limit=5)

    while not stop.is_set():
        if os.getenv("RESEND_FROM", "").strip():
            try:
                await asyncio.to_thread(batch)
            except Exception:
                # Never include DB parameters, recipients, or message contents.
                logger.warning("Notification batch failed; delivery remains queued")
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            pass


def process_batch(db, limit=25, runner=subprocess.run):
    sender = os.getenv("RESEND_FROM", "").strip()
    if not sender:
        # Domain/sender is not ready: preserve queued records without consuming
        # attempts or pretending delivery succeeded.
        return {"processed": 0, "sent": 0, "skipped": "RESEND_FROM is not configured"}
    records = list(db.scalars(select(NotificationOutbox).where(
        NotificationOutbox.sent_at.is_(None),
        NotificationOutbox.attempts < 10).order_by(
            NotificationOutbox.created_at).with_for_update(skip_locked=True).limit(limit)))
    sent = 0
    for item in records:
        payload = json.dumps({"from": sender, "to": item.recipient,
            "subject": item.subject, "text": item.body, "idempotencyKey": item.id})
        try:
            result = runner(["node", str(BRIDGE)], input=payload, text=True,
                            capture_output=True, timeout=30, check=False)
            output = json.loads(result.stdout or "{}")
            if result.returncode == 0 and output.get("id"):
                item.sent_at, item.last_error = datetime.now(timezone.utc), None
                sent += 1
            else:
                item.attempts += 1
                item.last_error = str(output.get("error", "Email bridge failed"))[:1000]
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            item.attempts += 1
            item.last_error = f"Email bridge unavailable: {type(exc).__name__}"
    db.flush()
    return {"processed": len(records), "sent": sent}


if __name__ == "__main__":
    if SessionLocal is None:
        raise SystemExit("DATABASE_URL is not configured")
    with SessionLocal.begin() as session:
        result = process_batch(session)
    print(json.dumps(result))