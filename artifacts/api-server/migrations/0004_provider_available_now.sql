-- Provider "Available now" switch (auto-expiring). Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ;
