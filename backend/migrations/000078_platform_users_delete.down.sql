DROP INDEX IF EXISTS idx_users_deleted_at;

DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug = 'platform.users.delete');
DELETE FROM permissions WHERE slug = 'platform.users.delete';
