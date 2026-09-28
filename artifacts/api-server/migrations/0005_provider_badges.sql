-- Provider badges: founding provider flag and reply-speed stats. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_provider BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_response_minutes DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS response_samples INTEGER NOT NULL DEFAULT 0;
