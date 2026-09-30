-- Society / apartment pages: residents recommend helpers they have used. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
CREATE TABLE IF NOT EXISTS society_recommendations (
    id VARCHAR(36) PRIMARY KEY,
    society_slug VARCHAR(80) NOT NULL,
    society_name VARCHAR(120) NOT NULL,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    provider_id VARCHAR(36) NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_society_recommendation UNIQUE (society_slug, user_id, provider_id)
);
CREATE INDEX IF NOT EXISTS ix_society_recommendations_slug ON society_recommendations (society_slug);
