ALTER TABLE organizations
    DROP CONSTRAINT IF EXISTS chk_organizations_sector,
    DROP COLUMN IF EXISTS sector;

ALTER TABLE ai_conversations DROP COLUMN IF EXISTS last_message_preview;

DROP INDEX IF EXISTS idx_activity_events_org_resource_uuid;
