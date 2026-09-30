-- "Notify me when someone is free" alerts. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
CREATE TABLE IF NOT EXISTS free_alerts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    category VARCHAR(20),
    keyword VARCHAR(60),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_free_alerts_user_id ON free_alerts (user_id);
CREATE INDEX IF NOT EXISTS ix_free_alerts_expires_at ON free_alerts (expires_at);
