INSERT INTO permissions (name, slug) VALUES
    ('Read tenant finance', 'tenant.finance.read'),
    ('Write tenant finance', 'tenant.finance.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO roles (name, slug, description, is_system) VALUES
    ('Organization Owner', 'organization_owner', 'Business owner with finance write access', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.finance.read'
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'auth.session',
    'notifications.read',
    'tenant.finance.read',
    'tenant.finance.write'
)
WHERE r.slug = 'organization_owner'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT DISTINCT om.user_id, r.id
FROM organization_members om
JOIN roles r ON r.slug = 'organization_owner'
WHERE om.role = 'owner'
ON CONFLICT DO NOTHING;
