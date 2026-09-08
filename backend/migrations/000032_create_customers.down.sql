DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE slug IN ('tenant.customers.read', 'tenant.customers.write')
);

DELETE FROM permissions
WHERE slug IN ('tenant.customers.read', 'tenant.customers.write');

DROP TABLE IF EXISTS customer_vehicles;
DROP TABLE IF EXISTS customers;
