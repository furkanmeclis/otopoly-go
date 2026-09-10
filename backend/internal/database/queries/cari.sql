-- Tenant cari (accounts receivable) accounts and ledger entries.

-- name: CreateCariAccount :one
INSERT INTO cari_accounts (
    organization_id, customer_id, currency, balance, is_active
) VALUES (
    $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetCariAccountByUUID :one
SELECT a.*,
       c.uuid AS customer_uuid,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.email AS customer_email,
       c.kind AS customer_kind,
       c.is_active AS customer_is_active
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id
WHERE a.uuid = $1 AND a.organization_id = $2 AND a.deleted_at IS NULL;

-- name: GetCariAccountByCustomerID :one
SELECT * FROM cari_accounts
WHERE customer_id = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: GetCariAccountByID :one
SELECT * FROM cari_accounts
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListCariAccounts :many
SELECT a.*,
       c.uuid AS customer_uuid,
       c.name AS customer_name,
       c.phone AS customer_phone,
       c.kind AS customer_kind
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
WHERE a.organization_id = sqlc.arg(organization_id) AND a.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR a.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(has_balance)::boolean IS NULL
    OR (sqlc.narg(has_balance) = true AND a.balance <> 0)
    OR (sqlc.narg(has_balance) = false AND a.balance = 0)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR c.email ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'balance' THEN a.balance END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-balance' THEN a.balance END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'customer_name' THEN c.name END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-customer_name' THEN c.name END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN a.created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-created_at' THEN a.created_at END DESC,
    c.name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountCariAccounts :one
SELECT COUNT(*)::bigint
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
WHERE a.organization_id = sqlc.arg(organization_id) AND a.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR a.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(has_balance)::boolean IS NULL
    OR (sqlc.narg(has_balance) = true AND a.balance <> 0)
    OR (sqlc.narg(has_balance) = false AND a.balance = 0)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR c.email ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: SumCariBalances :one
SELECT
    COALESCE(SUM(a.balance), 0)::numeric AS total_receivable,
    COUNT(*)::bigint AS account_count,
    COUNT(*) FILTER (WHERE a.balance <> 0)::bigint AS with_balance_count
FROM cari_accounts a
WHERE a.organization_id = $1 AND a.deleted_at IS NULL AND a.is_active = true;

-- name: AdjustCariAccountBalance :one
UPDATE cari_accounts
SET balance = balance + $3
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteCariAccountByCustomer :one
UPDATE cari_accounts
SET deleted_at = NOW(), is_active = false
WHERE customer_id = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: CreateCariEntry :one
INSERT INTO cari_entries (
    organization_id, account_id, type, amount, balance_after, entry_date,
    description, reference_no, payment_method, finance_account_id, finance_transaction_id,
    created_by, source_type, source_uuid, metadata
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
)
RETURNING *;

-- name: GetCariEntryByUUID :one
SELECT e.*,
       a.uuid AS account_uuid,
       c.uuid AS customer_uuid,
       c.name AS customer_name,
       fa.uuid AS finance_account_uuid,
       fa.name AS finance_account_name,
       ft.uuid AS finance_transaction_uuid
FROM cari_entries e
JOIN cari_accounts a ON a.id = e.account_id
JOIN customers c ON c.id = a.customer_id
LEFT JOIN finance_accounts fa ON fa.id = e.finance_account_id
LEFT JOIN finance_transactions ft ON ft.id = e.finance_transaction_id
WHERE e.uuid = $1 AND e.organization_id = $2;

-- name: ListCariEntries :many
SELECT e.*,
       a.uuid AS account_uuid,
       fa.uuid AS finance_account_uuid,
       fa.name AS finance_account_name,
       ft.uuid AS finance_transaction_uuid
FROM cari_entries e
JOIN cari_accounts a ON a.id = e.account_id
LEFT JOIN finance_accounts fa ON fa.id = e.finance_account_id
LEFT JOIN finance_transactions ft ON ft.id = e.finance_transaction_id
WHERE e.organization_id = sqlc.arg(organization_id)
  AND e.account_id = sqlc.arg(account_id)
  AND (sqlc.narg(type)::text IS NULL OR e.type = sqlc.narg(type))
  AND (sqlc.narg(status)::text IS NULL OR e.status = sqlc.narg(status))
  AND (sqlc.narg(date_from)::date IS NULL OR e.entry_date >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::date IS NULL OR e.entry_date <= sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR e.description ILIKE '%' || sqlc.narg(q) || '%'
    OR e.reference_no ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY e.entry_date DESC, e.created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountCariEntries :one
SELECT COUNT(*)::bigint
FROM cari_entries e
WHERE e.organization_id = sqlc.arg(organization_id)
  AND e.account_id = sqlc.arg(account_id)
  AND (sqlc.narg(type)::text IS NULL OR e.type = sqlc.narg(type))
  AND (sqlc.narg(status)::text IS NULL OR e.status = sqlc.narg(status))
  AND (sqlc.narg(date_from)::date IS NULL OR e.entry_date >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::date IS NULL OR e.entry_date <= sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR e.description ILIKE '%' || sqlc.narg(q) || '%'
    OR e.reference_no ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: VoidCariEntry :one
UPDATE cari_entries
SET status = 'void', voided_at = NOW(), voided_by = $3
WHERE uuid = $1 AND organization_id = $2 AND status = 'posted'
RETURNING *;

-- name: ListCariAccountsForExport :many
SELECT a.uuid, a.currency, a.balance, a.is_active, a.created_at,
       c.name AS customer_name, c.phone AS customer_phone, c.kind AS customer_kind
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
WHERE a.organization_id = sqlc.arg(organization_id) AND a.deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR a.is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(has_balance)::boolean IS NULL
    OR (sqlc.narg(has_balance) = true AND a.balance <> 0)
    OR (sqlc.narg(has_balance) = false AND a.balance = 0)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY c.name ASC;

-- name: ListCariEntriesForExport :many
SELECT e.uuid, e.type, e.status, e.amount, e.balance_after, e.entry_date,
       e.description, e.reference_no, e.payment_method, e.created_at,
       c.name AS customer_name
FROM cari_entries e
JOIN cari_accounts a ON a.id = e.account_id
JOIN customers c ON c.id = a.customer_id
WHERE e.organization_id = sqlc.arg(organization_id)
  AND e.account_id = sqlc.arg(account_id)
  AND (sqlc.narg(type)::text IS NULL OR e.type = sqlc.narg(type))
  AND (sqlc.narg(status)::text IS NULL OR e.status = sqlc.narg(status))
ORDER BY e.entry_date DESC, e.created_at DESC;

-- name: ListCariAccountsForSearch :many
SELECT a.uuid, a.balance, a.currency, a.is_active, a.organization_id,
       c.name AS customer_name, c.phone AS customer_phone,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
JOIN organizations o ON o.id = a.organization_id
WHERE a.deleted_at IS NULL;

-- name: GetCariAccountForSearch :one
SELECT a.uuid, a.balance, a.currency, a.is_active, a.organization_id,
       c.name AS customer_name, c.phone AS customer_phone,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
JOIN organizations o ON o.id = a.organization_id
WHERE a.uuid = $1 AND o.uuid = $2 AND a.deleted_at IS NULL;

-- name: LinkCariEntryFinanceTransaction :one
UPDATE cari_entries
SET finance_transaction_id = $3, finance_account_id = $4
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: GetCariEntryBySource :one
SELECT * FROM cari_entries
WHERE organization_id = $1
  AND source_type = $2
  AND source_uuid = $3
  AND status = 'posted'
LIMIT 1;

-- name: VoidCariEntryBySource :one
UPDATE cari_entries
SET status = 'void', voided_at = NOW(), voided_by = $4
WHERE organization_id = $1
  AND source_type = $2
  AND source_uuid = $3
  AND status = 'posted'
RETURNING *;
