-- System-wide vehicle brand / model / year catalog.

-- name: CreateVehicleBrand :one
INSERT INTO vehicle_brands (name, is_active)
VALUES ($1, $2)
RETURNING *;

-- name: GetVehicleBrandByUUID :one
SELECT * FROM vehicle_brands
WHERE uuid = $1 AND deleted_at IS NULL;

-- name: GetVehicleBrandByName :one
SELECT * FROM vehicle_brands
WHERE lower(name) = lower($1) AND deleted_at IS NULL;

-- name: ListVehicleBrands :many
SELECT
    b.*,
    (
        SELECT COUNT(*)::bigint
        FROM vehicle_models m
        WHERE m.brand_id = b.id AND m.deleted_at IS NULL
    ) AS model_count
FROM vehicle_brands b
WHERE b.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR b.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR b.name ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'name' THEN b.name END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-name' THEN b.name END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN b.created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-created_at' THEN b.created_at END DESC,
    b.name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountVehicleBrands :one
SELECT COUNT(*)::bigint
FROM vehicle_brands b
WHERE b.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR b.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR b.name ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateVehicleBrand :one
UPDATE vehicle_brands
SET name = COALESCE(sqlc.narg(name), name),
    is_active = COALESCE(sqlc.narg(is_active), is_active),
    logo_object_key = CASE
        WHEN sqlc.narg(set_logo)::boolean = true THEN sqlc.narg(logo_object_key)
        ELSE logo_object_key
    END
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteVehicleBrand :one
UPDATE vehicle_brands
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND deleted_at IS NULL
RETURNING *;

-- name: CountActiveVehicleModelsByBrand :one
SELECT COUNT(*)::bigint
FROM vehicle_models
WHERE brand_id = $1 AND deleted_at IS NULL;

-- name: CreateVehicleModel :one
INSERT INTO vehicle_models (brand_id, name, is_active)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetVehicleModelByUUID :one
SELECT * FROM vehicle_models
WHERE uuid = $1 AND deleted_at IS NULL;

-- name: GetVehicleModelByBrandAndName :one
SELECT * FROM vehicle_models
WHERE brand_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL;

-- name: ListVehicleModelsByBrand :many
SELECT m.*
FROM vehicle_models m
WHERE m.brand_id = $1 AND m.deleted_at IS NULL
ORDER BY m.name ASC;

-- name: UpdateVehicleModel :one
UPDATE vehicle_models
SET name = COALESCE(sqlc.narg(name), name),
    is_active = COALESCE(sqlc.narg(is_active), is_active)
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteVehicleModel :one
UPDATE vehicle_models
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND deleted_at IS NULL
RETURNING *;

-- name: CountCustomerVehiclesByModel :one
SELECT COUNT(*)::bigint
FROM customer_vehicles
WHERE model_id = $1 AND deleted_at IS NULL;

-- name: AddVehicleModelYear :exec
INSERT INTO vehicle_model_years (model_id, year)
VALUES ($1, $2)
ON CONFLICT (model_id, year) DO NOTHING;

-- name: DeleteVehicleModelYear :exec
DELETE FROM vehicle_model_years
WHERE model_id = $1 AND year = $2;

-- name: ListVehicleModelYears :many
SELECT year
FROM vehicle_model_years
WHERE model_id = $1
ORDER BY year DESC;

-- name: VehicleModelYearExists :one
SELECT EXISTS (
    SELECT 1 FROM vehicle_model_years
    WHERE model_id = $1 AND year = $2
) AS exists;

-- name: ListVehicleModelYearsForSearch :many
SELECT
    m.uuid AS model_uuid,
    m.name AS model_name,
    b.uuid AS brand_uuid,
    b.name AS brand_name,
    y.year
FROM vehicle_model_years y
JOIN vehicle_models m ON m.id = y.model_id AND m.deleted_at IS NULL AND m.is_active = true
JOIN vehicle_brands b ON b.id = m.brand_id AND b.deleted_at IS NULL AND b.is_active = true
ORDER BY b.name ASC, m.name ASC, y.year DESC;

-- name: GetVehicleModelYearForSearch :one
SELECT
    m.uuid AS model_uuid,
    m.name AS model_name,
    b.uuid AS brand_uuid,
    b.name AS brand_name,
    y.year
FROM vehicle_model_years y
JOIN vehicle_models m ON m.id = y.model_id AND m.deleted_at IS NULL
JOIN vehicle_brands b ON b.id = m.brand_id AND b.deleted_at IS NULL
WHERE m.uuid = $1 AND y.year = $2;

-- name: ListVehicleModelYearIDsByModel :many
SELECT m.uuid AS model_uuid, y.year
FROM vehicle_model_years y
JOIN vehicle_models m ON m.id = y.model_id
WHERE m.uuid = $1;

-- name: ListVehicleModelYearIDsByBrand :many
SELECT m.uuid AS model_uuid, y.year
FROM vehicle_model_years y
JOIN vehicle_models m ON m.id = y.model_id AND m.deleted_at IS NULL
JOIN vehicle_brands b ON b.id = m.brand_id
WHERE b.uuid = $1;

-- name: SearchVehicleCatalogOptions :many
SELECT
    b.uuid AS brand_uuid,
    b.name AS brand_name,
    b.logo_object_key,
    m.uuid AS model_uuid,
    m.name AS model_name,
    y.year
FROM vehicle_model_years y
JOIN vehicle_models m ON m.id = y.model_id AND m.deleted_at IS NULL AND m.is_active = true
JOIN vehicle_brands b ON b.id = m.brand_id AND b.deleted_at IS NULL AND b.is_active = true
WHERE (
    b.name ILIKE '%' || sqlc.arg(q) || '%'
    OR m.name ILIKE '%' || sqlc.arg(q) || '%'
    OR y.year::text ILIKE '%' || sqlc.arg(q) || '%'
    OR (b.name || ' ' || m.name || ' ' || y.year::text) ILIKE '%' || sqlc.arg(q) || '%'
)
ORDER BY b.name ASC, m.name ASC, y.year DESC
LIMIT sqlc.arg(limit_count);

-- name: GetVehicleCatalogOption :one
SELECT
    b.uuid AS brand_uuid,
    b.name AS brand_name,
    b.logo_object_key,
    m.uuid AS model_uuid,
    m.name AS model_name,
    m.id AS model_id,
    y.year
FROM vehicle_model_years y
JOIN vehicle_models m ON m.id = y.model_id AND m.deleted_at IS NULL
JOIN vehicle_brands b ON b.id = m.brand_id AND b.deleted_at IS NULL
WHERE m.uuid = $1 AND y.year = $2;
