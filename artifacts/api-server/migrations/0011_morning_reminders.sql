-- Morning "Are you working today?" reminders for providers. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reminded_on DATE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS email_reminders BOOLEAN NOT NULL DEFAULT TRUE;
