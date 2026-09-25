-- Leads & quotes permissions: owners and staff (organization_user) read and
-- write, mirroring tenant.todos.* (000049).
INSERT INTO permissions (name, slug) VALUES
    ('Read tenant leads', 'tenant.leads.read'),
    ('Write tenant leads', 'tenant.leads.write'),
    ('Read tenant quotes', 'tenant.quotes.read'),
    ('Write tenant quotes', 'tenant.quotes.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.leads.read', 'tenant.leads.write',
    'tenant.quotes.read', 'tenant.quotes.write'
)
WHERE r.slug IN ('organization_owner', 'organization_user', 'super_admin')
ON CONFLICT DO NOTHING;
