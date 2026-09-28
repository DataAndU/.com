-- Native Google sign-in (replaces Clerk). Additive and non-destructive:
-- no table, column or row is dropped or rewritten. users.clerk_user_id is
-- kept (made nullable) for rollback and audit.
--
-- Apply: python python/apply_migrations.py   (runs every *.sql in order, autocommit)
-- Safe to re-run (IF NOT EXISTS everywhere).
--
-- Rollback (only after reverting the application code):
--   DROP TABLE IF EXISTS oauth_login_attempts;
--   DROP TABLE IF EXISTS auth_sessions;
--   -- google_sub / the two indexes may stay; old code ignores them.
--   -- clerk_user_id NOT NULL can only be restored if no Google-only users exist.

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);

ALTER TABLE users ALTER COLUMN clerk_user_id DROP NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ix_users_google_sub ON users (google_sub);

-- Case-insensitive lookup used to link Clerk-era accounts by verified email.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_auth_sessions_user_id ON auth_sessions (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_auth_sessions_expires_at ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS oauth_login_attempts (
    browser_hash VARCHAR(64) PRIMARY KEY,
    state VARCHAR(128) NOT NULL,
    nonce VARCHAR(128) NOT NULL,
    code_verifier VARCHAR(128) NOT NULL,
    next_path VARCHAR(512) NOT NULL DEFAULT '/home',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_oauth_login_attempts_created_at ON oauth_login_attempts (created_at);
