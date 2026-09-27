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
