-- Tenant quick product sales.

-- name: CreateProductSale :one
INSERT INTO product_sales (
    organization_id, customer_id, customer_name, customer_phone,
    status, currency, total_amount, method,
    finance_account_id, finance_transaction_id, cari_entry_id,
    notes, sold_at, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
RETURNING *;

-- name: CreateProductSaleLine :one
INSERT INTO product_sale_lines (
    organization_id, sale_id, product_id, name,
    unit_price, qty, vat_rate, line_total, currency, sort_order
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: LinkProductSaleFinance :one
UPDATE product_sales
SET finance_transaction_id = $3,
    finance_account_id = COALESCE($4, finance_account_id),
    updated_at = NOW()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: LinkProductSaleCari :one
UPDATE product_sales
SET cari_entry_id = $3, updated_at = NOW()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: VoidProductSale :one
UPDATE product_sales
SET status = 'voided',
    voided_at = NOW(),
    voided_by = $3,
    updated_at = NOW()
WHERE uuid = $1 AND organization_id = $2 AND status = 'posted'
RETURNING *;

-- name: GetProductSaleByUUID :one
SELECT s.*,
       c.uuid AS customer_uuid,
       fa.uuid AS finance_account_uuid,
       fa.name AS finance_account_name,
       ft.uuid AS finance_transaction_uuid,
       ce.uuid AS cari_entry_uuid
FROM product_sales s
LEFT JOIN customers c ON c.id = s.customer_id
LEFT JOIN finance_accounts fa ON fa.id = s.finance_account_id
LEFT JOIN finance_transactions ft ON ft.id = s.finance_transaction_id
LEFT JOIN cari_entries ce ON ce.id = s.cari_entry_id
WHERE s.uuid = $1 AND s.organization_id = $2;

-- name: ListProductSaleLines :many
SELECT l.*, p.uuid AS product_uuid
FROM product_sale_lines l
JOIN products p ON p.id = l.product_id
WHERE l.sale_id = $1 AND l.organization_id = $2
ORDER BY l.sort_order ASC, l.id ASC;

-- name: ListProductSales :many
SELECT s.*,
       c.uuid AS customer_uuid
FROM product_sales s
LEFT JOIN customers c ON c.id = s.customer_id
WHERE s.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR s.status = sqlc.narg(status))
  AND (sqlc.narg(date_from)::timestamptz IS NULL OR s.sold_at >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::timestamptz IS NULL OR s.sold_at < sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.customer_phone ILIKE '%' || sqlc.narg(q) || '%'
    OR s.notes ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'sold_at' THEN s.sold_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-sold_at' THEN s.sold_at END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'total_amount' THEN s.total_amount END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-total_amount' THEN s.total_amount END DESC,
    s.sold_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountProductSales :one
SELECT COUNT(*)::bigint
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR s.status = sqlc.narg(status))
  AND (sqlc.narg(date_from)::timestamptz IS NULL OR s.sold_at >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::timestamptz IS NULL OR s.sold_at < sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.customer_phone ILIKE '%' || sqlc.narg(q) || '%'
    OR s.notes ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: SumProductSalesDaily :one
SELECT
    COUNT(*) FILTER (WHERE status = 'posted')::bigint AS sale_count,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'posted' AND method = 'card'), 0)::numeric AS card_total,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'posted' AND method = 'cari'), 0)::numeric AS cari_total,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'posted' AND method IN ('cash', 'card')), 0)::numeric AS net_total,
    COALESCE(SUM(total_amount) FILTER (WHERE status = 'posted'), 0)::numeric AS paid_total
FROM product_sales
WHERE organization_id = $1
  AND sold_at >= $2
  AND sold_at < $3;

-- name: ListProductSalesForExport :many
SELECT s.*
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR s.status = sqlc.narg(status))
  AND (
    sqlc.narg(q)::text IS NULL
    OR s.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR s.customer_phone ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY s.sold_at DESC;

-- name: ListProductSalesForSearch :many
SELECT s.uuid, s.customer_name, s.customer_phone, s.status, s.currency, s.total_amount, s.sold_at,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM product_sales s
JOIN organizations o ON o.id = s.organization_id
WHERE s.status = 'posted'
ORDER BY s.sold_at DESC
LIMIT 5000;

-- name: GetProductSaleForSearch :one
SELECT s.uuid, s.customer_name, s.customer_phone, s.status, s.currency, s.total_amount, s.sold_at,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM product_sales s
JOIN organizations o ON o.id = s.organization_id
WHERE s.uuid = $1 AND o.uuid = $2;
