-- Refer-a-provider codes and credits. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by VARCHAR(36);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_credit_months INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ix_users_referral_code ON users (referral_code);
