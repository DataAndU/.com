"""Morning reminder: at 8 AM India time, providers with active listings who
are not switched on get "Are you working today?" (in-app, plus email unless
they turned reminders off). Each provider is claimed once per day with a row
lock, so several API processes never send duplicates."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select

from models import Listing, Notification, NotificationOutbox, NotificationPreference, User

IST = ZoneInfo("Asia/Kolkata")
SEND_HOUR = 8
BATCH = 200


def enqueue_morning_reminders(db, now=None):
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(IST)
    if local.hour < SEND_HOUR:
        return 0
    today = local.date()
    has_listing = select(Listing.provider_id).where(Listing.status == "active")
    providers = list(db.scalars(select(User).where(
        User.role == "provider", User.suspended.is_(False), User.id.in_(has_listing),
        or_(User.last_reminded_on.is_(None), User.last_reminded_on < today),
        or_(User.available_until.is_(None), User.available_until <= now),
    ).with_for_update(skip_locked=True).limit(BATCH)))
    if not providers:
        return 0
    opted_out = set(db.scalars(select(NotificationPreference.user_id).where(
        NotificationPreference.user_id.in_([p.id for p in providers]),
        NotificationPreference.email_reminders.is_(False))))
    for provider in providers:
        provider.last_reminded_on = today
        db.add(Notification(user_id=provider.id, type="morning_reminder",
                            title="Are you working today?",
                            body="Switch on Available now so nearby customers can find you."))
        if provider.id not in opted_out and provider.email:
            db.add(NotificationOutbox(
                user_id=provider.id, recipient=provider.email,
                subject="Are you working today? ☀️",
                body=("Good morning! Customers near you are looking for help today.\n\n"
                      "Open Pontreol and switch on \"Available now\" to show up as a green pin "
                      "on the map for the next few hours: https://pontreol.com/home\n\n"
                      "Don't want these? Turn off \"Morning reminders\" in Notifications.")))
    db.flush()
    return len(providers)
