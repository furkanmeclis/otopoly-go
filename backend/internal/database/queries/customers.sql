-- Tenant customers and their vehicles.

-- name: CreateCustomer :one
INSERT INTO customers (
    organization_id, name, phone, email, kind, notes, is_active, tax_id, tax_office
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: GetCustomerByUUID :one
SELECT * FROM customers
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListCustomers :many
SELECT
    c.*,
    (
        SELECT COUNT(*)::bigint
        FROM customer_vehicles v
        WHERE v.customer_id = c.id AND v.deleted_at IS NULL
    ) AS vehicle_count
FROM customers c
WHERE c.organization_id = sqlc.arg(organization_id) AND c.deleted_at IS NULL
  AND (sqlc.narg(kind)::text IS NULL OR c.kind = sqlc.narg(kind))
  AND (sqlc.narg(is_active)::boolean IS NULL OR c.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR c.email ILIKE '%' || sqlc.narg(q) || '%'
    OR EXISTS (
        SELECT 1 FROM customer_vehicles v
        WHERE v.customer_id = c.id AND v.deleted_at IS NULL
          AND v.plate ILIKE '%' || sqlc.narg(q) || '%'
    )
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'name' THEN c.name END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-name' THEN c.name END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN c.created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-created_at' THEN c.created_at END DESC,
    c.name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountCustomers :one
SELECT COUNT(*)::bigint
FROM customers c
WHERE c.organization_id = sqlc.arg(organization_id) AND c.deleted_at IS NULL
  AND (sqlc.narg(kind)::text IS NULL OR c.kind = sqlc.narg(kind))
  AND (sqlc.narg(is_active)::boolean IS NULL OR c.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR c.email ILIKE '%' || sqlc.narg(q) || '%'
    OR EXISTS (
        SELECT 1 FROM customer_vehicles v
        WHERE v.customer_id = c.id AND v.deleted_at IS NULL
          AND v.plate ILIKE '%' || sqlc.narg(q) || '%'
    )
  );

-- name: UpdateCustomer :one
UPDATE customers
SET name = COALESCE(sqlc.narg(name), name),
    phone = COALESCE(sqlc.narg(phone), phone),
    email = COALESCE(sqlc.narg(email), email),
    kind = COALESCE(sqlc.narg(kind), kind),
    notes = COALESCE(sqlc.narg(notes), notes),
    is_active = COALESCE(sqlc.narg(is_active), is_active),
    tax_id = COALESCE(sqlc.narg(tax_id), tax_id),
    tax_office = COALESCE(sqlc.narg(tax_office), tax_office)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteCustomer :one
UPDATE customers
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: CreateCustomerVehicle :one
INSERT INTO customer_vehicles (
    organization_id, customer_id, plate, model_id, year
) VALUES (
    $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetCustomerVehicleByUUID :one
SELECT * FROM customer_vehicles
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListCustomerVehicles :many
SELECT
    v.*,
    b.uuid AS brand_uuid,
    b.name AS brand_name,
    b.logo_object_key,
    m.uuid AS model_uuid,
    m.name AS model_name
FROM customer_vehicles v
JOIN vehicle_models m ON m.id = v.model_id
JOIN vehicle_brands b ON b.id = m.brand_id
WHERE v.customer_id = $1 AND v.organization_id = $2 AND v.deleted_at IS NULL
ORDER BY v.created_at ASC;

-- name: SoftDeleteCustomerVehicle :one
UPDATE customer_vehicles
SET deleted_at = NOW()
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteCustomerVehiclesByCustomer :exec
UPDATE customer_vehicles
SET deleted_at = NOW()
WHERE customer_id = $1 AND organization_id = $2 AND deleted_at IS NULL;
