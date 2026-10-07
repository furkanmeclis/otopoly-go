-- TEC-518: scope audit events to an organization so the platform
-- organization detail can show "activity for this business".
ALTER TABLE activity_events
    ADD COLUMN organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL;

-- Backfill what can be attributed reliably: platform organization actions
-- (resource_uuid is the organization) and events that carry the organization
-- uuid in their payload.
UPDATE activity_events a
SET organization_id = o.id
FROM organizations o
WHERE a.organization_id IS NULL
  AND a.resource = 'platform.organizations'
  AND a.resource_uuid = o.uuid;

UPDATE activity_events a
SET organization_id = o.id
FROM organizations o
WHERE a.organization_id IS NULL
  AND a.payload->>'organization_uuid' = o.uuid::text;

CREATE INDEX idx_activity_events_org_created
    ON activity_events (organization_id, created_at DESC)
    WHERE organization_id IS NOT NULL;
