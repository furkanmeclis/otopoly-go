INSERT INTO permissions (name, slug) VALUES
    ('Read tenant reports', 'tenant.reports.read'),
    ('Export tenant reports', 'tenant.reports.export')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.reports.read', 'tenant.reports.export')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.reports.read',
    'tenant.reports.export'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
