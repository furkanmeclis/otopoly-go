-- Tenant suppliers (firmalar).

-- name: CreateSupplier :one
INSERT INTO suppliers (
    organization_id, name, phone, email, tax_id, notes, is_active
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetSupplierByUUID :one
SELECT * FROM suppliers
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListSuppliers :many
SELECT *
FROM suppliers
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR phone ILIKE '%' || sqlc.narg(q) || '%'
    OR email ILIKE '%' || sqlc.narg(q) || '%'
    OR tax_id ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'name' THEN name END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-name' THEN name END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-created_at' THEN created_at END DESC,
    name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountSuppliers :one
SELECT COUNT(*)::bigint
FROM suppliers
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR phone ILIKE '%' || sqlc.narg(q) || '%'
    OR email ILIKE '%' || sqlc.narg(q) || '%'
    OR tax_id ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateSupplier :one
UPDATE suppliers
SET name = COALESCE(sqlc.narg(name), name),
    phone = COALESCE(sqlc.narg(phone), phone),
    email = COALESCE(sqlc.narg(email), email),
    tax_id = COALESCE(sqlc.narg(tax_id), tax_id),
    notes = COALESCE(sqlc.narg(notes), notes),
    is_active = COALESCE(sqlc.narg(is_active), is_active)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteSupplier :one
UPDATE suppliers
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: ListSuppliersForExport :many
SELECT *
FROM suppliers
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR phone ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY name ASC;

-- name: ListSuppliersForSearch :many
SELECT s.uuid, s.name, s.phone, s.email, s.tax_id, s.is_active,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM suppliers s
JOIN organizations o ON o.id = s.organization_id
WHERE s.deleted_at IS NULL AND s.is_active = true
ORDER BY s.name ASC
LIMIT 5000;

-- name: GetSupplierForSearch :one
SELECT s.uuid, s.name, s.phone, s.email, s.tax_id, s.is_active,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM suppliers s
JOIN organizations o ON o.id = s.organization_id
WHERE s.uuid = $1 AND o.uuid = $2 AND s.deleted_at IS NULL;

-- name: CountPostedPurchasesBySupplier :one
SELECT COUNT(*)::bigint
FROM purchases
WHERE supplier_id = $1 AND organization_id = $2 AND status = 'posted';
