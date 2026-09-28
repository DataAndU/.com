-- Admin-managed seasonal/festival banner. Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
CREATE TABLE IF NOT EXISTS site_banners (
    id VARCHAR(36) PRIMARY KEY,
    message VARCHAR(200) NOT NULL,
    link_path VARCHAR(200),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
