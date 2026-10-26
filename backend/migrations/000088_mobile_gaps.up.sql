-- Mobile API gaps.

-- Customer activity feed: events are looked up by the uuids of a customer's
-- records (customer, vehicles, jobs, sales, quotes, leads, cari entries,
-- contracts) inside one organization, newest first.
CREATE INDEX idx_activity_events_org_resource_uuid
    ON activity_events (organization_id, resource_uuid, created_at DESC)
    WHERE organization_id IS NOT NULL AND resource_uuid IS NOT NULL;

-- AI conversation list: short plain-text preview of the last user/assistant
-- text, maintained when a message is written.
ALTER TABLE ai_conversations
    ADD COLUMN last_message_preview VARCHAR(200) NOT NULL DEFAULT '';

UPDATE ai_conversations c
SET last_message_preview = sub.preview
FROM (
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id,
           left(btrim(regexp_replace(
               regexp_replace(b.block->>'text', '[*_`#>~|]+', '', 'g'),
               '\s+', ' ', 'g')), 120) AS preview
    FROM ai_messages m
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(m.ui) = 'array' THEN m.ui ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS b(block, ord)
    WHERE b.block->>'type' = 'text'
      AND btrim(COALESCE(b.block->>'text', '')) <> ''
    ORDER BY m.conversation_id, m.id DESC, b.ord DESC
) sub
WHERE c.id = sub.conversation_id;

-- Organization sector / business type (optional).
ALTER TABLE organizations
    ADD COLUMN sector VARCHAR(32) NULL,
    ADD CONSTRAINT chk_organizations_sector CHECK (
        sector IS NULL
        OR sector IN ('car_wash', 'detailing', 'ppf_tint', 'auto_service', 'tyres', 'other')
    );
