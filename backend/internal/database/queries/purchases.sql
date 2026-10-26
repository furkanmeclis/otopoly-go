-- Tenant stock purchases.

-- name: CreatePurchase :one
INSERT INTO purchases (
    organization_id, supplier_id, supplier_name,
    status, currency, total_amount, method,
    finance_account_id, finance_transaction_id,
    notes, purchased_at, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: CreatePurchaseLine :one
INSERT INTO purchase_lines (
    organization_id, purchase_id, product_id, name,
    unit_cost, qty, line_total, currency, sort_order
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: LinkPurchaseFinance :one
UPDATE purchases
SET finance_transaction_id = $3,
    finance_account_id = COALESCE($4, finance_account_id),
    updated_at = NOW()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: VoidPurchase :one
UPDATE purchases
SET status = 'voided',
    voided_at = NOW(),
    voided_by = $3,
    updated_at = NOW()
WHERE uuid = $1 AND organization_id = $2 AND status = 'posted'
RETURNING *;

-- name: GetPurchaseByUUID :one
SELECT p.*,
       s.uuid AS supplier_uuid,
       fa.uuid AS finance_account_uuid,
       fa.name AS finance_account_name,
       ft.uuid AS finance_transaction_uuid
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
LEFT JOIN finance_accounts fa ON fa.id = p.finance_account_id
LEFT JOIN finance_transactions ft ON ft.id = p.finance_transaction_id
WHERE p.uuid = $1 AND p.organization_id = $2;

-- name: ListPurchaseLines :many
SELECT l.*, pr.uuid AS product_uuid
FROM purchase_lines l
JOIN products pr ON pr.id = l.product_id
WHERE l.purchase_id = $1 AND l.organization_id = $2
ORDER BY l.sort_order ASC, l.id ASC;

-- name: ListPurchaseLinesByPurchaseIDs :many
SELECT l.*, pr.uuid AS product_uuid
FROM purchase_lines l
JOIN products pr ON pr.id = l.product_id
WHERE l.organization_id = sqlc.arg(organization_id)
  AND l.purchase_id = ANY (sqlc.arg(purchase_ids)::bigint[])
ORDER BY l.purchase_id ASC, l.sort_order ASC, l.id ASC;

-- name: ListPurchases :many
SELECT p.*,
       s.uuid AS supplier_uuid
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
WHERE p.organization_id = sqlc.arg(organization_id)
  AND (
    (sqlc.narg(status)::text IS NULL AND p.status <> 'draft')
    OR p.status = sqlc.narg(status)
  )
  AND (sqlc.narg(date_from)::timestamptz IS NULL OR p.purchased_at >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::timestamptz IS NULL OR p.purchased_at < sqlc.narg(date_to))
  AND (
    sqlc.narg(supplier_uuid)::uuid IS NULL
    OR p.supplier_id = (
        SELECT fs.id FROM suppliers fs
        WHERE fs.uuid = sqlc.narg(supplier_uuid) AND fs.organization_id = sqlc.arg(organization_id)
    )
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.supplier_name ILIKE '%' || sqlc.narg(q) || '%'
    OR p.notes ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'purchased_at' THEN p.purchased_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-purchased_at' THEN p.purchased_at END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'total_amount' THEN p.total_amount END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-total_amount' THEN p.total_amount END DESC,
    p.purchased_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountPurchases :one
SELECT COUNT(*)::bigint
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)
  AND (
    (sqlc.narg(status)::text IS NULL AND p.status <> 'draft')
    OR p.status = sqlc.narg(status)
  )
  AND (sqlc.narg(date_from)::timestamptz IS NULL OR p.purchased_at >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::timestamptz IS NULL OR p.purchased_at < sqlc.narg(date_to))
  AND (
    sqlc.narg(supplier_uuid)::uuid IS NULL
    OR p.supplier_id = (
        SELECT fs.id FROM suppliers fs
        WHERE fs.uuid = sqlc.narg(supplier_uuid) AND fs.organization_id = sqlc.arg(organization_id)
    )
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.supplier_name ILIKE '%' || sqlc.narg(q) || '%'
    OR p.notes ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: ListPurchasesForExport :many
SELECT p.*
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)
  AND (
    (sqlc.narg(status)::text IS NULL AND p.status <> 'draft')
    OR p.status = sqlc.narg(status)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR p.supplier_name ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY p.purchased_at DESC;

-- name: ListPurchasesForSearch :many
SELECT p.uuid, p.supplier_name, p.status, p.currency, p.total_amount, p.purchased_at,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM purchases p
JOIN organizations o ON o.id = p.organization_id
WHERE p.status = 'posted'
ORDER BY p.purchased_at DESC
LIMIT 5000;

-- name: GetPurchaseForSearch :one
SELECT p.uuid, p.supplier_name, p.status, p.currency, p.total_amount, p.purchased_at,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM purchases p
JOIN organizations o ON o.id = p.organization_id
WHERE p.uuid = $1 AND o.uuid = $2;

-- name: GetDraftPurchaseForUpdate :one
SELECT * FROM purchases
WHERE uuid = $1 AND organization_id = $2 AND status = 'draft'
FOR UPDATE;

-- name: UpdateDraftPurchase :one
UPDATE purchases
SET supplier_id = sqlc.arg(supplier_id),
    supplier_name = sqlc.arg(supplier_name),
    currency = sqlc.arg(currency),
    total_amount = sqlc.arg(total_amount),
    notes = sqlc.arg(notes),
    updated_at = NOW()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND status = 'draft'
RETURNING *;

-- name: PostDraftPurchase :one
-- Turns a draft into a posted purchase; stock and finance are applied by the
-- caller in the same transaction.
UPDATE purchases
SET status = 'posted',
    supplier_id = sqlc.arg(supplier_id),
    supplier_name = sqlc.arg(supplier_name),
    currency = sqlc.arg(currency),
    total_amount = sqlc.arg(total_amount),
    method = sqlc.arg(method),
    finance_account_id = sqlc.arg(finance_account_id),
    notes = sqlc.arg(notes),
    purchased_at = sqlc.arg(purchased_at),
    updated_at = NOW()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND status = 'draft'
RETURNING *;

-- name: DeletePurchaseLines :exec
DELETE FROM purchase_lines
WHERE purchase_id = $1 AND organization_id = $2;

-- name: DeleteDraftPurchase :execrows
DELETE FROM purchases
WHERE uuid = $1 AND organization_id = $2 AND status = 'draft';

-- name: CountDraftPurchases :one
SELECT COUNT(*)::bigint FROM purchases
WHERE organization_id = $1 AND status = 'draft';
