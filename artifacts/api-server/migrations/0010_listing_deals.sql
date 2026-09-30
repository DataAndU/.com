-- Last-minute deals on listings. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE listings ADD COLUMN IF NOT EXISTS deal_percent INTEGER;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS deal_until TIMESTAMPTZ;
