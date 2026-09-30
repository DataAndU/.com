-- Photo reviews (before/after pictures). Additive; safe to re-run.
-- Apply: python python/apply_migrations.py
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS photo_ids JSON NOT NULL DEFAULT '[]';
