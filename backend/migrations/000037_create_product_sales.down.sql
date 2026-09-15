DROP TABLE IF EXISTS product_sale_lines;
DROP TABLE IF EXISTS product_sales;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.sales.read',
        'tenant.sales.write',
        'tenant.sales.export'
    )
);

DELETE FROM permissions
WHERE slug IN (
    'tenant.sales.read',
    'tenant.sales.write',
    'tenant.sales.export'
);
