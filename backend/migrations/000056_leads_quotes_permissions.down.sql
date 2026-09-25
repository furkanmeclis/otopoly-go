DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.leads.read', 'tenant.leads.write',
        'tenant.quotes.read', 'tenant.quotes.write'
    )
);
DELETE FROM permissions WHERE slug IN (
    'tenant.leads.read', 'tenant.leads.write',
    'tenant.quotes.read', 'tenant.quotes.write'
);
