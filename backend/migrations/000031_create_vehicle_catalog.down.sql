DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE slug IN ('platform.vehicle_brands.read', 'platform.vehicle_brands.write')
);

DELETE FROM permissions
WHERE slug IN ('platform.vehicle_brands.read', 'platform.vehicle_brands.write');

DROP TABLE IF EXISTS vehicle_model_years;
DROP TABLE IF EXISTS vehicle_models;
DROP TABLE IF EXISTS vehicle_brands;
