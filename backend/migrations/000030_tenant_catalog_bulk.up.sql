INSERT INTO permissions (name, slug) VALUES
    ('Bulk activate catalog products', 'tenant.catalog.products.bulk.activate'),
    ('Bulk deactivate catalog products', 'tenant.catalog.products.bulk.deactivate'),
    ('Bulk delete catalog products', 'tenant.catalog.products.bulk.delete'),
    ('Bulk raise catalog product sale price', 'tenant.catalog.products.bulk.raise_sale_price'),
    ('Bulk raise catalog product cost price', 'tenant.catalog.products.bulk.raise_cost_price'),
    ('Bulk adjust catalog product stock', 'tenant.catalog.products.bulk.adjust_stock'),
    ('Bulk activate catalog services', 'tenant.catalog.services.bulk.activate'),
    ('Bulk deactivate catalog services', 'tenant.catalog.services.bulk.deactivate'),
    ('Bulk delete catalog services', 'tenant.catalog.services.bulk.delete'),
    ('Bulk raise catalog service price', 'tenant.catalog.services.bulk.raise_price')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.catalog.products.bulk.activate',
    'tenant.catalog.products.bulk.deactivate',
    'tenant.catalog.products.bulk.delete',
    'tenant.catalog.products.bulk.raise_sale_price',
    'tenant.catalog.products.bulk.raise_cost_price',
    'tenant.catalog.products.bulk.adjust_stock',
    'tenant.catalog.services.bulk.activate',
    'tenant.catalog.services.bulk.deactivate',
    'tenant.catalog.services.bulk.delete',
    'tenant.catalog.services.bulk.raise_price'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
