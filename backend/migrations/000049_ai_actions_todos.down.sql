-- Drops all todos and AI pending actions; revokes staff access to the assistant.

DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE slug = 'organization_user')
  AND permission_id IN (SELECT id FROM permissions WHERE slug = 'tenant.ai.use');

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN ('tenant.todos.read', 'tenant.todos.write')
);
DELETE FROM permissions WHERE slug IN ('tenant.todos.read', 'tenant.todos.write');

DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS ai_pending_actions;
