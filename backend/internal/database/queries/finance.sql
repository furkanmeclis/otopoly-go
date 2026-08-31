-- Finance module queries (tenant-scoped via organization_id).
-- TODO(finance): Add GetFinanceCategoryByID, ListFinanceTransactionsForExport (io-engine),
-- and composite indexes if list/filter latency grows (organization_id + transaction_date DESC).

-- name: CreateFinanceAccount :one
INSERT INTO finance_accounts (
    organization_id, name, type, currency, opening_balance, current_balance,
    is_default, is_active, bank_name, iban, notes
) VALUES (
    $1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: GetFinanceAccountByUUID :one
SELECT * FROM finance_accounts
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: GetFinanceAccountByID :one
SELECT * FROM finance_accounts
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListFinanceAccounts :many
SELECT * FROM finance_accounts
WHERE organization_id = $1 AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR bank_name ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY is_default DESC, name ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountFinanceAccounts :one
SELECT COUNT(*)::bigint FROM finance_accounts
WHERE organization_id = $1 AND deleted_at IS NULL
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR bank_name ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateFinanceAccount :one
UPDATE finance_accounts
SET name = COALESCE(sqlc.narg(name), name),
    type = COALESCE(sqlc.narg(type), type),
    currency = COALESCE(sqlc.narg(currency), currency),
    is_default = COALESCE(sqlc.narg(is_default), is_default),
    is_active = COALESCE(sqlc.narg(is_active), is_active),
    bank_name = sqlc.narg(bank_name),
    iban = sqlc.narg(iban),
    notes = COALESCE(sqlc.narg(notes), notes)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteFinanceAccount :one
UPDATE finance_accounts
SET deleted_at = NOW(), is_active = false, is_default = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: AdjustFinanceAccountBalance :one
UPDATE finance_accounts
SET current_balance = current_balance + $3
WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: ClearFinanceAccountDefault :exec
UPDATE finance_accounts
SET is_default = false
WHERE organization_id = $1 AND deleted_at IS NULL AND is_default = true;

-- name: CreateFinanceCategory :one
INSERT INTO finance_categories (organization_id, parent_id, name, kind, sort_order, is_active)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetFinanceCategoryByUUID :one
SELECT * FROM finance_categories
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListFinanceCategories :many
SELECT * FROM finance_categories
WHERE organization_id = $1 AND deleted_at IS NULL
  AND (sqlc.narg(kind)::text IS NULL OR kind = sqlc.narg(kind))
  AND (sqlc.narg(is_active)::boolean IS NULL OR is_active = sqlc.narg(is_active))
ORDER BY kind ASC, sort_order ASC, name ASC;

-- name: UpdateFinanceCategory :one
UPDATE finance_categories
SET name = COALESCE(sqlc.narg(name), name),
    parent_id = sqlc.narg(parent_id),
    sort_order = COALESCE(sqlc.narg(sort_order), sort_order),
    is_active = COALESCE(sqlc.narg(is_active), is_active)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteFinanceCategory :one
UPDATE finance_categories
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: CreateFinanceTransaction :one
INSERT INTO finance_transactions (
    organization_id, type, status, account_id, counter_account_id, category_id,
    amount, currency, transaction_date, description, reference_no, payment_method,
    created_by, source_type, source_uuid, metadata
) VALUES (
    $1, $2, 'posted', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
)
RETURNING *;

-- name: GetFinanceTransactionByUUID :one
SELECT * FROM finance_transactions
WHERE uuid = $1 AND organization_id = $2;

-- name: ListFinanceTransactions :many
SELECT t.*,
       a.uuid AS account_uuid, a.name AS account_name,
       ca.uuid AS counter_account_uuid, ca.name AS counter_account_name,
       c.uuid AS category_uuid, c.name AS category_name
FROM finance_transactions t
JOIN finance_accounts a ON a.id = t.account_id
LEFT JOIN finance_accounts ca ON ca.id = t.counter_account_id
LEFT JOIN finance_categories c ON c.id = t.category_id
WHERE t.organization_id = $1
  AND (sqlc.narg(type)::text IS NULL OR t.type = sqlc.narg(type))
  AND (sqlc.narg(status)::text IS NULL OR t.status = sqlc.narg(status))
  AND (sqlc.narg(account_uuid)::uuid IS NULL OR a.uuid = sqlc.narg(account_uuid))
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(date_from)::date IS NULL OR t.transaction_date >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::date IS NULL OR t.transaction_date <= sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR t.description ILIKE '%' || sqlc.narg(q) || '%'
    OR t.reference_no ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY t.transaction_date DESC, t.created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountFinanceTransactions :one
SELECT COUNT(*)::bigint
FROM finance_transactions t
JOIN finance_accounts a ON a.id = t.account_id
LEFT JOIN finance_categories c ON c.id = t.category_id
WHERE t.organization_id = $1
  AND (sqlc.narg(type)::text IS NULL OR t.type = sqlc.narg(type))
  AND (sqlc.narg(status)::text IS NULL OR t.status = sqlc.narg(status))
  AND (sqlc.narg(account_uuid)::uuid IS NULL OR a.uuid = sqlc.narg(account_uuid))
  AND (sqlc.narg(category_uuid)::uuid IS NULL OR c.uuid = sqlc.narg(category_uuid))
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(date_from)::date IS NULL OR t.transaction_date >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::date IS NULL OR t.transaction_date <= sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR t.description ILIKE '%' || sqlc.narg(q) || '%'
    OR t.reference_no ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: VoidFinanceTransaction :one
UPDATE finance_transactions
SET status = 'void', voided_at = NOW(), voided_by = $3
WHERE uuid = $1 AND organization_id = $2 AND status = 'posted'
RETURNING *;

-- name: SumFinanceTransactionsByType :many
SELECT type, COALESCE(SUM(amount), 0)::numeric AS total
FROM finance_transactions
WHERE organization_id = $1
  AND status = 'posted'
  AND transaction_date >= $2
  AND transaction_date <= $3
  AND (sqlc.narg(currency)::text IS NULL OR currency = sqlc.narg(currency))
GROUP BY type;

-- name: SumFinanceExpensesByCategory :many
SELECT c.uuid AS category_uuid, c.name AS category_name,
       COALESCE(SUM(t.amount), 0)::numeric AS total
FROM finance_transactions t
JOIN finance_categories c ON c.id = t.category_id
WHERE t.organization_id = $1
  AND t.type = 'expense'
  AND t.status = 'posted'
  AND t.transaction_date >= $2
  AND t.transaction_date <= $3
GROUP BY c.uuid, c.name
ORDER BY total DESC;

-- name: ListRecentFinanceTransactionsByAccount :many
SELECT t.*,
       c.uuid AS category_uuid, c.name AS category_name
FROM finance_transactions t
LEFT JOIN finance_categories c ON c.id = t.category_id
WHERE t.organization_id = $1
  AND (t.account_id = $2 OR t.counter_account_id = $2)
ORDER BY t.transaction_date DESC, t.created_at DESC
LIMIT $3;

-- name: GetFinanceAccountStats :one
SELECT
  COUNT(*) FILTER (WHERE t.status = 'posted')::bigint AS posted_count,
  COUNT(*) FILTER (WHERE t.status = 'void')::bigint AS void_count,
  COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'posted' AND t.type = 'income' AND t.account_id = sqlc.arg(account_id)), 0)::numeric AS total_income,
  COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'posted' AND t.type = 'expense' AND t.account_id = sqlc.arg(account_id)), 0)::numeric AS total_expense,
  COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'posted' AND t.type = 'transfer' AND t.counter_account_id = sqlc.arg(account_id)), 0)::numeric AS transfer_in,
  COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'posted' AND t.type = 'transfer' AND t.account_id = sqlc.arg(account_id)), 0)::numeric AS transfer_out
FROM finance_transactions t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND (t.account_id = sqlc.arg(account_id) OR t.counter_account_id = sqlc.arg(account_id));

-- name: GetFinanceCategoryStats :one
SELECT
  COUNT(*) FILTER (WHERE t.status = 'posted')::bigint AS posted_count,
  COUNT(*) FILTER (WHERE t.status = 'void')::bigint AS void_count,
  COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'posted'), 0)::numeric AS total_amount
FROM finance_transactions t
WHERE t.organization_id = $1 AND t.category_id = $2;
