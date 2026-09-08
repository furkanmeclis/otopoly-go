DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
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
);

DELETE FROM permissions
WHERE slug IN (
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
);
