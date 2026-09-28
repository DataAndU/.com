-- Email OTP sign-in (replaces Google sign-in). Additive and non-destructive:
-- nothing is dropped. users.clerk_user_id, users.google_sub, auth_sessions
-- and oauth_login_attempts are all kept (history/rollback).
--
-- Apply: python python/apply_migrations.py   (runs every *.sql in order, autocommit)
-- Safe to re-run (IF NOT EXISTS everywhere).
--
-- Rollback (only after reverting the application code):
--   DROP TABLE IF EXISTS email_otp_challenges;
--   DROP TABLE IF EXISTS auth_rate_events;

CREATE TABLE IF NOT EXISTS email_otp_challenges (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    code_salt VARCHAR(32) NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    ip_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_email_otp_challenges_email ON email_otp_challenges (email);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_email_otp_challenges_ip_hash ON email_otp_challenges (ip_hash);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_email_otp_challenges_created_at ON email_otp_challenges (created_at);

CREATE TABLE IF NOT EXISTS auth_rate_events (
    id VARCHAR(36) PRIMARY KEY,
    ip_hash VARCHAR(64) NOT NULL,
    kind VARCHAR(24) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_auth_rate_events_ip_hash ON auth_rate_events (ip_hash);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_auth_rate_events_created_at ON auth_rate_events (created_at);
