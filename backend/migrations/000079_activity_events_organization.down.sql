DROP INDEX IF EXISTS idx_activity_events_org_created;
ALTER TABLE activity_events DROP COLUMN IF EXISTS organization_id;
