-- Pontreol performance indexes (additive, non-destructive, idempotent).
--
-- Apply once per database, outside a transaction (CONCURRENTLY avoids
-- blocking writes on a live table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f artifacts/api-server/migrations/0001_performance_indexes.sql
--
-- Rollback (safe at any time):
--   DROP INDEX CONCURRENTLY IF EXISTS ix_listings_active_lat_lng;
--   DROP INDEX CONCURRENTLY IF EXISTS ix_messages_conversation_created;
--   DROP INDEX CONCURRENTLY IF EXISTS ix_notifications_user_created;
--
-- Do NOT use psql --single-transaction / -1 (CONCURRENTLY cannot run in a
-- transaction). If a build is interrupted, Postgres leaves an INVALID index
-- that IF NOT EXISTS would then skip. Check and repair before re-running:
--   SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--    WHERE NOT i.indisvalid AND c.relname LIKE 'ix_%';
--   DROP INDEX CONCURRENTLY IF EXISTS <that index>;   -- then re-run this file
--
-- No PostGIS required. When listing volume needs it, the scaling path is a
-- geography(Point) column with a GiST index queried via ST_DWithin.

-- /home/summary and /listings?lat=&lng= bounding-box prefilter on active listings.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_listings_active_lat_lng
    ON listings (latitude, longitude) WHERE status = 'active';

-- Conversation message history ordered by time, and latest-message previews.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_messages_conversation_created
    ON messages (conversation_id, created_at);

-- Notification inbox keyset pagination (user_id, created_at DESC, id DESC).
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_notifications_user_created
    ON notifications (user_id, created_at, id);

ANALYZE listings;
ANALYZE messages;
ANALYZE notifications;
