-- Tenant operational / financial reports (read-only aggregates).

-- name: ReportFinanceTotals :one
SELECT
    COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::numeric AS total_income,
    COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS total_expense,
    COUNT(*) FILTER (WHERE t.type = 'income')::bigint AS income_count,
    COUNT(*) FILTER (WHERE t.type = 'expense')::bigint AS expense_count
FROM finance_transactions t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.status = 'posted'
  AND t.transaction_date >= sqlc.arg(date_from)
  AND t.transaction_date <= sqlc.arg(date_to)
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(source_type)::text IS NULL OR t.source_type = sqlc.narg(source_type))
  AND (
    sqlc.narg(account_id)::bigint IS NULL
    OR t.account_id = sqlc.narg(account_id)
    OR t.counter_account_id = sqlc.narg(account_id)
  );

-- name: ReportFinanceBySource :many
SELECT
    t.source_type,
    t.type,
    COALESCE(SUM(t.amount), 0)::numeric AS total,
    COUNT(*)::bigint AS count
FROM finance_transactions t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.status = 'posted'
  AND t.transaction_date >= sqlc.arg(date_from)
  AND t.transaction_date <= sqlc.arg(date_to)
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(source_type)::text IS NULL OR t.source_type = sqlc.narg(source_type))
  AND (
    sqlc.narg(account_id)::bigint IS NULL
    OR t.account_id = sqlc.narg(account_id)
    OR t.counter_account_id = sqlc.narg(account_id)
  )
GROUP BY t.source_type, t.type
ORDER BY total DESC;

-- name: ReportExpensesByCategory :many
SELECT
    c.uuid AS category_uuid,
    c.name AS category_name,
    COALESCE(SUM(t.amount), 0)::numeric AS total,
    COUNT(*)::bigint AS count
FROM finance_transactions t
JOIN finance_categories c ON c.id = t.category_id
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.type = 'expense'
  AND t.status = 'posted'
  AND t.transaction_date >= sqlc.arg(date_from)
  AND t.transaction_date <= sqlc.arg(date_to)
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(source_type)::text IS NULL OR t.source_type = sqlc.narg(source_type))
  AND (
    sqlc.narg(account_id)::bigint IS NULL
    OR t.account_id = sqlc.narg(account_id)
    OR t.counter_account_id = sqlc.narg(account_id)
  )
GROUP BY c.uuid, c.name
ORDER BY total DESC;

-- name: ReportIncomeByCategory :many
SELECT
    c.uuid AS category_uuid,
    c.name AS category_name,
    COALESCE(SUM(t.amount), 0)::numeric AS total,
    COUNT(*)::bigint AS count
FROM finance_transactions t
JOIN finance_categories c ON c.id = t.category_id
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.type = 'income'
  AND t.status = 'posted'
  AND t.transaction_date >= sqlc.arg(date_from)
  AND t.transaction_date <= sqlc.arg(date_to)
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(source_type)::text IS NULL OR t.source_type = sqlc.narg(source_type))
  AND (
    sqlc.narg(account_id)::bigint IS NULL
    OR t.account_id = sqlc.narg(account_id)
    OR t.counter_account_id = sqlc.narg(account_id)
  )
GROUP BY c.uuid, c.name
ORDER BY total DESC;

-- name: ReportFinanceTimeseries :many
SELECT
    date_trunc(sqlc.arg(granularity)::text, t.transaction_date::timestamptz)::date AS bucket,
    COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::numeric AS income,
    COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::numeric AS expense
FROM finance_transactions t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.status = 'posted'
  AND t.transaction_date >= sqlc.arg(date_from)
  AND t.transaction_date <= sqlc.arg(date_to)
  AND (sqlc.narg(currency)::text IS NULL OR t.currency = sqlc.narg(currency))
  AND (sqlc.narg(source_type)::text IS NULL OR t.source_type = sqlc.narg(source_type))
  AND (
    sqlc.narg(account_id)::bigint IS NULL
    OR t.account_id = sqlc.narg(account_id)
    OR t.counter_account_id = sqlc.narg(account_id)
  )
GROUP BY bucket
ORDER BY bucket ASC;

-- name: ReportJobStats :one
SELECT
    COUNT(*) FILTER (WHERE j.status IN ('delivered', 'ready', 'in_progress'))::bigint AS job_count,
    COUNT(*) FILTER (WHERE j.payment_status = 'paid')::bigint AS paid_count,
    COUNT(*) FILTER (WHERE j.status = 'ready')::bigint AS done_count,
    COUNT(*) FILTER (WHERE j.status = 'in_progress')::bigint AS in_progress_count,
    COUNT(*) FILTER (WHERE j.status = 'cancelled')::bigint AS cancelled_count,
    COALESCE(SUM(j.total_amount) FILTER (WHERE j.payment_status = 'paid'), 0)::numeric AS paid_total,
    COALESCE(AVG(j.total_amount) FILTER (WHERE j.payment_status = 'paid' AND j.total_amount > 0), 0)::numeric AS avg_ticket,
    COUNT(DISTINCT j.vehicle_id) FILTER (WHERE j.status IN ('delivered', 'ready', 'in_progress'))::bigint AS vehicles_served
FROM service_jobs j
WHERE j.organization_id = sqlc.arg(organization_id)
  AND j.started_at >= sqlc.arg(ts_from)
  AND j.started_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR j.currency = sqlc.narg(currency));

-- name: ReportJobPaymentsByMethod :many
SELECT
    p.method,
    COALESCE(SUM(p.amount), 0)::numeric AS total,
    COUNT(*)::bigint AS count
FROM service_job_payments p
JOIN service_jobs j ON j.id = p.job_id
WHERE p.organization_id = sqlc.arg(organization_id)
  AND p.status = 'posted'
  AND j.started_at >= sqlc.arg(ts_from)
  AND j.started_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR p.currency = sqlc.narg(currency))
  AND (sqlc.narg(payment_method)::text IS NULL OR p.method = sqlc.narg(payment_method))
GROUP BY p.method
ORDER BY total DESC;

-- name: ReportServicesDistribution :many
SELECT
    l.name AS service_name,
    COALESCE(SUM(l.qty), 0)::numeric AS qty,
    COALESCE(SUM(l.line_total), 0)::numeric AS total,
    COUNT(*)::bigint AS line_count
FROM service_job_lines l
JOIN service_jobs j ON j.id = l.job_id
WHERE l.organization_id = sqlc.arg(organization_id)
  AND l.line_type = 'service'
  AND j.status IN ('paid', 'done', 'in_progress')
  AND j.started_at >= sqlc.arg(ts_from)
  AND j.started_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR l.currency = sqlc.narg(currency))
GROUP BY l.name
ORDER BY total DESC
LIMIT 50;

-- name: ReportJobsTimeseries :many
SELECT
    date_trunc(sqlc.arg(granularity)::text, j.started_at)::date AS bucket,
    COUNT(*) FILTER (WHERE j.payment_status = 'paid')::bigint AS paid_count,
    COALESCE(SUM(j.total_amount) FILTER (WHERE j.payment_status = 'paid'), 0)::numeric AS paid_total
FROM service_jobs j
WHERE j.organization_id = sqlc.arg(organization_id)
  AND j.started_at >= sqlc.arg(ts_from)
  AND j.started_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR j.currency = sqlc.narg(currency))
GROUP BY bucket
ORDER BY bucket ASC;

-- name: ReportProductSaleStats :one
SELECT
    COUNT(*)::bigint AS sale_count,
    COALESCE(SUM(s.total_amount), 0)::numeric AS sale_total
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND s.status = 'posted'
  AND s.sold_at >= sqlc.arg(ts_from)
  AND s.sold_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR s.currency = sqlc.narg(currency))
  AND (sqlc.narg(payment_method)::text IS NULL OR s.method = sqlc.narg(payment_method));

-- name: ReportProductSalesByMethod :many
SELECT
    s.method,
    COALESCE(SUM(s.total_amount), 0)::numeric AS total,
    COUNT(*)::bigint AS count
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND s.status = 'posted'
  AND s.sold_at >= sqlc.arg(ts_from)
  AND s.sold_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR s.currency = sqlc.narg(currency))
  AND (sqlc.narg(payment_method)::text IS NULL OR s.method = sqlc.narg(payment_method))
GROUP BY s.method
ORDER BY total DESC;

-- name: ReportProductsDistribution :many
SELECT
    l.name AS product_name,
    COALESCE(SUM(l.qty), 0)::numeric AS qty,
    COALESCE(SUM(l.line_total), 0)::numeric AS total,
    COUNT(*)::bigint AS line_count
FROM product_sale_lines l
JOIN product_sales s ON s.id = l.sale_id
WHERE l.organization_id = sqlc.arg(organization_id)
  AND s.status = 'posted'
  AND s.sold_at >= sqlc.arg(ts_from)
  AND s.sold_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR l.currency = sqlc.narg(currency))
  AND (sqlc.narg(payment_method)::text IS NULL OR s.method = sqlc.narg(payment_method))
GROUP BY l.name
ORDER BY total DESC
LIMIT 50;

-- name: ReportPurchaseStats :one
SELECT
    COUNT(*)::bigint AS purchase_count,
    COALESCE(SUM(p.total_amount), 0)::numeric AS purchase_total
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)
  AND p.status = 'posted'
  AND p.purchased_at >= sqlc.arg(ts_from)
  AND p.purchased_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR p.currency = sqlc.narg(currency))
  AND (sqlc.narg(payment_method)::text IS NULL OR p.method = sqlc.narg(payment_method));

-- name: ReportCariPeriodTotals :one
SELECT
    COALESCE(SUM(e.amount) FILTER (WHERE e.type = 'charge'), 0)::numeric AS charged,
    COALESCE(SUM(e.amount) FILTER (WHERE e.type = 'payment'), 0)::numeric AS collected,
    COUNT(*) FILTER (WHERE e.type = 'charge')::bigint AS charge_count,
    COUNT(*) FILTER (WHERE e.type = 'payment')::bigint AS payment_count
FROM cari_entries e
WHERE e.organization_id = sqlc.arg(organization_id)
  AND e.status = 'posted'
  AND e.entry_date >= sqlc.arg(date_from)
  AND e.entry_date <= sqlc.arg(date_to)
  AND (sqlc.narg(currency)::text IS NULL OR EXISTS (
      SELECT 1 FROM cari_accounts a
      WHERE a.id = e.account_id AND a.currency = sqlc.narg(currency)
  ));

-- name: ReportCariOutstanding :many
SELECT
    a.uuid AS account_uuid,
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    c.phone AS customer_phone,
    a.currency,
    a.balance,
    (
        SELECT MAX(e.entry_date)::date
        FROM cari_entries e
        WHERE e.account_id = a.id AND e.status = 'posted'
    ) AS last_entry_date
FROM cari_accounts a
JOIN customers c ON c.id = a.customer_id AND c.deleted_at IS NULL
WHERE a.organization_id = sqlc.arg(organization_id)
  AND a.deleted_at IS NULL
  AND a.balance > 0
  AND a.is_active = true
  AND (sqlc.narg(currency)::text IS NULL OR a.currency = sqlc.narg(currency))
ORDER BY a.balance DESC
LIMIT 50;

-- name: ReportTopCustomers :many
SELECT
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    COALESCE(SUM(j.total_amount) FILTER (WHERE j.payment_status = 'paid'), 0)::numeric AS job_total,
    COUNT(*) FILTER (WHERE j.payment_status = 'paid')::bigint AS job_count
FROM service_jobs j
JOIN customers c ON c.id = j.customer_id
WHERE j.organization_id = sqlc.arg(organization_id)
  AND j.started_at >= sqlc.arg(ts_from)
  AND j.started_at < sqlc.arg(ts_to)
  AND (sqlc.narg(currency)::text IS NULL OR j.currency = sqlc.narg(currency))
GROUP BY c.uuid, c.name
HAVING COUNT(*) FILTER (WHERE j.payment_status = 'paid') > 0
ORDER BY job_total DESC
LIMIT 20;

-- name: GetFinanceAccountIDByUUIDForReport :one
SELECT id FROM finance_accounts
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;
