-- Drops all AI assistant data (conversations, messages, usage ledger, settings incl. encrypted API key).

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN ('platform.ai.read', 'platform.ai.write', 'tenant.ai.use')
);
DELETE FROM permissions WHERE slug IN ('platform.ai.read', 'platform.ai.write', 'tenant.ai.use');

DROP TABLE IF EXISTS ai_usage;
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_conversations;
DROP TABLE IF EXISTS ai_organization_settings;
DROP TABLE IF EXISTS ai_settings;
