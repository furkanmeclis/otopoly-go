-- Platform admin user deletion (soft delete via users.deleted_at) and restore.
INSERT INTO permissions (name, slug) VALUES
    ('Delete platform users', 'platform.users.delete')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug = 'platform.users.delete'
WHERE r.slug = 'super_admin' ON CONFLICT DO NOTHING;

-- Deleted-users filter on the platform user list.
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
    ON users (deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
