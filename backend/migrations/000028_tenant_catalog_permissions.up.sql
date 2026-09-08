INSERT INTO permissions (name, slug) VALUES
    ('Read tenant catalog', 'tenant.catalog.read'),
    ('Write tenant catalog', 'tenant.catalog.write'),
    ('Export tenant catalog', 'tenant.catalog.export'),
    ('Import tenant catalog', 'tenant.catalog.import')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.catalog.read',
    'tenant.catalog.export'
)
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.catalog.read',
    'tenant.catalog.write',
    'tenant.catalog.export',
    'tenant.catalog.import'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
