DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.catalog.read',
        'tenant.catalog.write',
        'tenant.catalog.export',
        'tenant.catalog.import'
    )
);

DELETE FROM permissions
WHERE slug IN (
    'tenant.catalog.read',
    'tenant.catalog.write',
    'tenant.catalog.export',
    'tenant.catalog.import'
);
