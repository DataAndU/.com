-- "Share my trip" links for travel bookings. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS share_token_hash VARCHAR(64);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ix_bookings_share_token_hash ON bookings (share_token_hash);
