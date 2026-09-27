-- Catalog module queries (tenant-scoped via organization_id).

-- ============================================================================
-- Categories
-- ============================================================================

-- name: CreateCatalogCategory :one
INSERT INTO catalog_categories (
    organization_id, parent_id, name, kind, sort_order, is_active
) VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING *;

-- name: GetCatalogCategoryByUUID :one
SELECT * FROM catalog_categories
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: GetCatalogCategoryByID :one
SELECT * FROM catalog_categories
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: GetCatalogCategoryByName :one
SELECT * FROM catalog_categories
WHERE organization_id = $1 AND kind = $2 AND lower(name) = lower($3) AND deleted_at IS NULL;

-- name: ListCatalogCategories :many
SELECT c.*, p.name AS parent_name
FROM catalog_categories c
LEFT JOIN catalog_categories p ON p.id = c.parent_id AND p.deleted_at IS NULL
WHERE c.organization_id = $1 AND c.deleted_at IS NULL
  AND (sqlc.narg(kind)::text IS NULL OR c.kind = sqlc.narg(kind))
  AND (sqlc.narg(is_active)::boolean IS NULL OR c.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY c.kind ASC, c.sort_order ASC, c.name ASC;

-- name: CountCatalogCategories :one
SELECT COUNT(*)::bigint FROM catalog_categories
WHERE organization_id = $1 AND deleted_at IS NULL
  AND (sqlc.narg(kind)::text IS NULL OR kind = sqlc.narg(kind))
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateCatalogCategory :one
UPDATE catalog_categories
SET name = COALESCE(sqlc.narg(name), name),
    parent_id = CASE WHEN sqlc.narg(set_parent)::boolean = true THEN sqlc.narg(parent_id) ELSE parent_id END,
    kind = COALESCE(sqlc.narg(kind), kind),
    sort_order = COALESCE(sqlc.narg(sort_order), sort_order),
    is_active = COALESCE(sqlc.narg(is_active), is_active)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteCatalogCategory :one
UPDATE catalog_categories
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- ============================================================================
-- Products
-- ============================================================================

-- name: CreateProduct :one
INSERT INTO products (
    organization_id, category_id, name, sku, barcode, unit,
    cost_price, sale_price, vat_rate, currency,
    stock_quantity, min_stock_alert, track_stock, is_active, description
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10,
    $11, $12, $13, $14, $15
)
RETURNING *;

-- name: GetProductByUUID :one
SELECT p.*, c.uuid AS category_uuid, c.name AS category_name
FROM products p
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.uuid = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL;

-- name: GetProductByID :one
SELECT * FROM products
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: GetProductByName :one
SELECT * FROM products
WHERE organization_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL;

-- name: GetProductBySKU :one
SELECT * FROM products
WHERE organization_id = $1 AND lower(sku) = lower($2) AND deleted_at IS NULL;

-- name: GetProductByBarcode :one
SELECT * FROM products
WHERE organization_id = $1 AND lower(barcode) = lower($2) AND deleted_at IS NULL;

-- name: ListProducts :many
SELECT p.*, c.uuid AS category_uuid, c.name AS category_name
FROM products p
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.organization_id = $1 AND p.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR p.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(track_stock)::boolean IS NULL OR p.track_stock = sqlc.narg(track_stock))
  AND (sqlc.narg(unit)::text IS NULL OR p.unit = sqlc.narg(unit))
  AND (
    sqlc.narg(stock_status)::text IS NULL
    OR (sqlc.narg(stock_status) = 'in_stock' AND p.track_stock = true AND p.stock_quantity > p.min_stock_alert)
    OR (sqlc.narg(stock_status) = 'low_stock' AND p.track_stock = true AND p.stock_quantity <= p.min_stock_alert AND p.stock_quantity > 0)
    OR (sqlc.narg(stock_status) = 'out_of_stock' AND p.track_stock = true AND p.stock_quantity <= 0)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.name ILIKE '%' || sqlc.narg(q) || '%'
    OR p.sku ILIKE '%' || sqlc.narg(q) || '%'
    OR p.barcode ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
  CASE WHEN sqlc.narg(sort_by)::text = 'name_asc' THEN p.name END ASC,
  CASE WHEN sqlc.narg(sort_by)::text = 'name_desc' THEN p.name END DESC,
  CASE WHEN sqlc.narg(sort_by)::text = 'stock_asc' THEN p.stock_quantity END ASC,
  CASE WHEN sqlc.narg(sort_by)::text = 'stock_desc' THEN p.stock_quantity END DESC,
  CASE WHEN sqlc.narg(sort_by)::text = 'price_asc' THEN p.sale_price END ASC,
  CASE WHEN sqlc.narg(sort_by)::text = 'price_desc' THEN p.sale_price END DESC,
  p.name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountProducts :one
SELECT COUNT(*)::bigint
FROM products p
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.organization_id = $1 AND p.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR p.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(track_stock)::boolean IS NULL OR p.track_stock = sqlc.narg(track_stock))
  AND (sqlc.narg(unit)::text IS NULL OR p.unit = sqlc.narg(unit))
  AND (
    sqlc.narg(stock_status)::text IS NULL
    OR (sqlc.narg(stock_status) = 'in_stock' AND p.track_stock = true AND p.stock_quantity > p.min_stock_alert)
    OR (sqlc.narg(stock_status) = 'low_stock' AND p.track_stock = true AND p.stock_quantity <= p.min_stock_alert AND p.stock_quantity > 0)
    OR (sqlc.narg(stock_status) = 'out_of_stock' AND p.track_stock = true AND p.stock_quantity <= 0)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.name ILIKE '%' || sqlc.narg(q) || '%'
    OR p.sku ILIKE '%' || sqlc.narg(q) || '%'
    OR p.barcode ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateProduct :one
UPDATE products
SET name = COALESCE(sqlc.narg(name), name),
    category_id = CASE WHEN sqlc.narg(set_category)::boolean = true THEN sqlc.narg(category_id) ELSE category_id END,
    sku = CASE WHEN sqlc.narg(set_sku)::boolean = true THEN sqlc.narg(sku) ELSE sku END,
    barcode = CASE WHEN sqlc.narg(set_barcode)::boolean = true THEN sqlc.narg(barcode) ELSE barcode END,
    unit = COALESCE(sqlc.narg(unit), unit),
    cost_price = COALESCE(sqlc.narg(cost_price), cost_price),
    sale_price = COALESCE(sqlc.narg(sale_price), sale_price),
    vat_rate = COALESCE(sqlc.narg(vat_rate), vat_rate),
    currency = COALESCE(sqlc.narg(currency), currency),
    stock_quantity = COALESCE(sqlc.narg(stock_quantity), stock_quantity),
    min_stock_alert = COALESCE(sqlc.narg(min_stock_alert), min_stock_alert),
    track_stock = COALESCE(sqlc.narg(track_stock), track_stock),
    is_active = COALESCE(sqlc.narg(is_active), is_active),
    description = COALESCE(sqlc.narg(description), description)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: AdjustProductStock :one
UPDATE products
SET stock_quantity = stock_quantity + sqlc.arg(delta)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteProduct :one
UPDATE products
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: ListProductsForExport :many
SELECT p.*, c.name AS category_name
FROM products p
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.organization_id = $1 AND p.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR p.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.name ILIKE '%' || sqlc.narg(q) || '%'
    OR p.sku ILIKE '%' || sqlc.narg(q) || '%'
    OR p.barcode ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY p.name ASC;

-- ============================================================================
-- Services
-- ============================================================================

-- name: CreateService :one
INSERT INTO services (
    organization_id, category_id, name, code, duration_minutes,
    price, vat_rate, currency, is_active, description, color
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10, $11
)
RETURNING *;

-- name: GetServiceByUUID :one
SELECT s.*, c.uuid AS category_uuid, c.name AS category_name
FROM services s
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.uuid = $1 AND s.organization_id = $2 AND s.deleted_at IS NULL;

-- name: GetServiceByID :one
SELECT * FROM services
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: GetServiceByName :one
SELECT * FROM services
WHERE organization_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL;

-- name: GetServiceByCode :one
SELECT * FROM services
WHERE organization_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL;

-- name: ListServices :many
SELECT s.*, c.uuid AS category_uuid, c.name AS category_name
FROM services s
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.organization_id = $1 AND s.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR s.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.code ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
  CASE WHEN sqlc.narg(sort_by)::text = 'name_asc' THEN s.name END ASC,
  CASE WHEN sqlc.narg(sort_by)::text = 'name_desc' THEN s.name END DESC,
  CASE WHEN sqlc.narg(sort_by)::text = 'price_asc' THEN s.price END ASC,
  CASE WHEN sqlc.narg(sort_by)::text = 'price_desc' THEN s.price END DESC,
  CASE WHEN sqlc.narg(sort_by)::text = 'duration_asc' THEN s.duration_minutes END ASC,
  CASE WHEN sqlc.narg(sort_by)::text = 'duration_desc' THEN s.duration_minutes END DESC,
  s.name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountServices :one
SELECT COUNT(*)::bigint
FROM services s
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.organization_id = $1 AND s.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR s.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.code ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateService :one
UPDATE services
SET name = COALESCE(sqlc.narg(name), name),
    category_id = CASE WHEN sqlc.narg(set_category)::boolean = true THEN sqlc.narg(category_id) ELSE category_id END,
    code = CASE WHEN sqlc.narg(set_code)::boolean = true THEN sqlc.narg(code) ELSE code END,
    duration_minutes = COALESCE(sqlc.narg(duration_minutes), duration_minutes),
    price = COALESCE(sqlc.narg(price), price),
    vat_rate = COALESCE(sqlc.narg(vat_rate), vat_rate),
    currency = COALESCE(sqlc.narg(currency), currency),
    is_active = COALESCE(sqlc.narg(is_active), is_active),
    description = COALESCE(sqlc.narg(description), description),
    color = COALESCE(sqlc.narg(color), color)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteService :one
UPDATE services
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: ListServicesForExport :many
SELECT s.*, c.name AS category_name
FROM services s
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.organization_id = $1 AND s.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR s.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.code ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY s.name ASC;

-- ============================================================================
-- Catalog Search Queries
-- ============================================================================

-- name: ListProductsForSearch :many
SELECT
    p.uuid,
    p.name,
    p.sku,
    p.barcode,
    p.sale_price,
    p.currency,
    p.stock_quantity,
    p.unit,
    p.is_active,
    c.name AS category_name,
    o.uuid AS organization_uuid,
    o.slug AS organization_slug
FROM products p
JOIN organizations o ON o.id = p.organization_id AND o.deleted_at IS NULL
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.deleted_at IS NULL;

-- name: GetProductForSearch :one
SELECT
    p.uuid,
    p.name,
    p.sku,
    p.barcode,
    p.sale_price,
    p.currency,
    p.stock_quantity,
    p.unit,
    p.is_active,
    c.name AS category_name,
    o.uuid AS organization_uuid,
    o.slug AS organization_slug
FROM products p
JOIN organizations o ON o.id = p.organization_id AND o.deleted_at IS NULL
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.uuid = sqlc.arg(uuid) AND o.uuid = sqlc.arg(org_uuid) AND p.deleted_at IS NULL;

-- name: ListServicesForSearch :many
SELECT
    s.uuid,
    s.name,
    s.code,
    s.price,
    s.currency,
    s.duration_minutes,
    s.is_active,
    c.name AS category_name,
    o.uuid AS organization_uuid,
    o.slug AS organization_slug
FROM services s
JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.deleted_at IS NULL;

-- name: GetServiceForSearch :one
SELECT
    s.uuid,
    s.name,
    s.code,
    s.price,
    s.currency,
    s.duration_minutes,
    s.is_active,
    c.name AS category_name,
    o.uuid AS organization_uuid,
    o.slug AS organization_slug
FROM services s
JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.uuid = sqlc.arg(uuid) AND o.uuid = sqlc.arg(org_uuid) AND s.deleted_at IS NULL;


-- name: GetCatalogStats :one
-- Each aggregate reads its own table: joining products, services and
-- categories together multiplies the product sums by the other row counts.
SELECT
    ps.total_products,
    ps.active_products,
    ps.low_stock_products,
    ps.out_of_stock_products,
    ps.total_stock_cost_value,
    ps.total_stock_sale_value,
    ss.total_services,
    ss.active_services,
    cs.total_categories
FROM (
    SELECT
        COUNT(*)::bigint AS total_products,
        COUNT(*) FILTER (WHERE p.is_active = true)::bigint AS active_products,
        COUNT(*) FILTER (WHERE p.is_active = true AND p.track_stock = true AND p.stock_quantity <= p.min_stock_alert AND p.stock_quantity > 0)::bigint AS low_stock_products,
        COUNT(*) FILTER (WHERE p.is_active = true AND p.track_stock = true AND p.stock_quantity <= 0)::bigint AS out_of_stock_products,
        COALESCE(SUM(p.stock_quantity * p.cost_price) FILTER (WHERE p.is_active = true AND p.track_stock = true), 0)::numeric(18,2) AS total_stock_cost_value,
        COALESCE(SUM(p.stock_quantity * p.sale_price) FILTER (WHERE p.is_active = true AND p.track_stock = true), 0)::numeric(18,2) AS total_stock_sale_value
    FROM products p
    WHERE p.organization_id = $1 AND p.deleted_at IS NULL
) ps,
(
    SELECT
        COUNT(*)::bigint AS total_services,
        COUNT(*) FILTER (WHERE s.is_active = true)::bigint AS active_services
    FROM services s
    WHERE s.organization_id = $1 AND s.deleted_at IS NULL
) ss,
(
    SELECT COUNT(*)::bigint AS total_categories
    FROM catalog_categories c
    WHERE c.organization_id = $1 AND c.deleted_at IS NULL
) cs;

-- name: ListProductUUIDsForBulk :many
SELECT p.uuid
FROM products p
LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
WHERE p.organization_id = $1 AND p.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR p.is_active = sqlc.narg(is_active))
  AND (sqlc.narg(track_stock)::boolean IS NULL OR p.track_stock = sqlc.narg(track_stock))
  AND (sqlc.narg(unit)::text IS NULL OR p.unit = sqlc.narg(unit))
  AND (
    sqlc.narg(stock_status)::text IS NULL
    OR (sqlc.narg(stock_status) = 'in_stock' AND p.track_stock = true AND p.stock_quantity > p.min_stock_alert)
    OR (sqlc.narg(stock_status) = 'low_stock' AND p.track_stock = true AND p.stock_quantity <= p.min_stock_alert AND p.stock_quantity > 0)
    OR (sqlc.narg(stock_status) = 'out_of_stock' AND p.track_stock = true AND p.stock_quantity <= 0)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.name ILIKE '%' || sqlc.narg(q) || '%'
    OR p.sku ILIKE '%' || sqlc.narg(q) || '%'
    OR p.barcode ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY p.name ASC;

-- name: RestoreProduct :exec
UPDATE products
SET deleted_at = NULL,
    is_active = $3,
    updated_at = NOW()
WHERE uuid = $1 AND organization_id = $2;

-- name: ListServiceUUIDsForBulk :many
SELECT s.uuid
FROM services s
LEFT JOIN catalog_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
WHERE s.organization_id = $1 AND s.deleted_at IS NULL
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(is_active)::boolean IS NULL OR s.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.code ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY s.name ASC;

-- name: RestoreService :exec
UPDATE services
SET deleted_at = NULL,
    is_active = $3,
    updated_at = NOW()
WHERE uuid = $1 AND organization_id = $2;
