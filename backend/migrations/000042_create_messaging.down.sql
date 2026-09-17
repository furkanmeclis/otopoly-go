DROP TABLE IF EXISTS outbound_messages;
DROP TABLE IF EXISTS notification_rules;
DROP TABLE IF EXISTS message_templates;
DROP TABLE IF EXISTS whatsapp_sessions;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN ('tenant.messaging.read', 'tenant.messaging.write')
);

DELETE FROM permissions
WHERE slug IN ('tenant.messaging.read', 'tenant.messaging.write');
