DROP TABLE IF EXISTS purchase_lines;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS suppliers;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.suppliers.read',
        'tenant.suppliers.write',
        'tenant.suppliers.export',
        'tenant.purchases.read',
        'tenant.purchases.write',
        'tenant.purchases.export'
    )
);

DELETE FROM permissions
WHERE slug IN (
    'tenant.suppliers.read',
    'tenant.suppliers.write',
    'tenant.suppliers.export',
    'tenant.purchases.read',
    'tenant.purchases.write',
    'tenant.purchases.export'
);
