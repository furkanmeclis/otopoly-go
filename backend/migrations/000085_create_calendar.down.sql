-- Data loss: every calendar event is dropped.
DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN ('tenant.calendar.read', 'tenant.calendar.write')
);
DELETE FROM permissions WHERE slug IN ('tenant.calendar.read', 'tenant.calendar.write');

DROP TABLE IF EXISTS calendar_events;
