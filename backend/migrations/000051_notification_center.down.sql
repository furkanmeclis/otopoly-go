-- Drops scheduled notifications, per-type preferences and member phones;
-- removes queued-body columns from outbound_messages (data loss).
DROP INDEX IF EXISTS idx_outbound_messages_scheduled;
ALTER TABLE outbound_messages
    DROP COLUMN IF EXISTS scheduled_notification_id,
    DROP COLUMN IF EXISTS attempts,
    DROP COLUMN IF EXISTS attachment,
    DROP COLUMN IF EXISTS body;

DROP TABLE IF EXISTS notification_member_settings;
DROP TABLE IF EXISTS notification_type_preferences;
DROP TABLE IF EXISTS scheduled_notifications;
