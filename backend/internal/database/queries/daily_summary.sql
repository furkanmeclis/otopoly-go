-- name: GetDailySummarySettings :one
SELECT * FROM daily_summary_settings
WHERE organization_id = $1;

-- name: UpsertDailySummarySettings :one
INSERT INTO daily_summary_settings (organization_id, enabled, send_time, recipient_user_ids)
VALUES (sqlc.arg(organization_id), sqlc.arg(enabled), sqlc.arg(send_time), sqlc.arg(recipient_user_ids)::bigint[])
ON CONFLICT (organization_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    send_time = EXCLUDED.send_time,
    recipient_user_ids = EXCLUDED.recipient_user_ids
RETURNING *;

-- name: ListEnabledDailySummarySettings :many
SELECT * FROM daily_summary_settings
WHERE enabled
ORDER BY organization_id;

-- name: ClaimDailySummary :execrows
-- Marks today's summary as sent; 0 rows when another sweep already claimed it.
UPDATE daily_summary_settings
SET last_sent_on = sqlc.arg(day)::date
WHERE organization_id = sqlc.arg(organization_id)
  AND enabled
  AND (last_sent_on IS NULL OR last_sent_on < sqlc.arg(day)::date);

-- name: ListDailySummaryMembers :many
-- Active organization members with their notification phone (may be empty).
SELECT u.id AS user_id,
       u.uuid AS user_uuid,
       u.name,
       u.surname,
       u.email,
       om.role,
       COALESCE(ms.phone, '')::text AS phone
FROM organization_members om
JOIN users u ON u.id = om.user_id
LEFT JOIN notification_member_settings ms
       ON ms.user_id = om.user_id AND ms.organization_id = om.organization_id
WHERE om.organization_id = $1
  AND u.status = 'active'
ORDER BY (om.role = 'owner') DESC, u.name, u.surname;

-- name: DailySummaryJobCounts :one
SELECT
    COUNT(*) FILTER (WHERE j.status NOT IN ('cancelled', 'voided'))::bigint AS job_count,
    COUNT(*) FILTER (WHERE j.status IN ('in_progress', 'ready'))::bigint AS open_count,
    COUNT(*) FILTER (WHERE j.status = 'delivered')::bigint AS delivered_count,
    COUNT(*) FILTER (WHERE j.status IN ('cancelled', 'voided'))::bigint AS cancelled_count,
    COUNT(*) FILTER (
        WHERE j.status NOT IN ('cancelled', 'voided') AND j.payment_status = 'unpaid'
    )::bigint AS unpaid_count,
    COALESCE(SUM(j.total_amount) FILTER (
        WHERE j.status NOT IN ('cancelled', 'voided') AND j.payment_status = 'unpaid'
    ), 0)::numeric AS unpaid_total
FROM service_jobs j
WHERE j.organization_id = sqlc.arg(organization_id)
  AND j.started_at >= sqlc.arg(date_from)
  AND j.started_at < sqlc.arg(date_to);

-- name: DailySummaryServiceBreakdown :many
-- Vehicles per service for the day ("12 × Yıkama, 1 × PPF").
SELECT l.name,
       COUNT(DISTINCT l.job_id)::bigint AS job_count
FROM service_job_lines l
JOIN service_jobs j ON j.id = l.job_id
WHERE l.organization_id = sqlc.arg(organization_id)
  AND l.line_type = 'service'
  AND j.status NOT IN ('cancelled', 'voided')
  AND j.started_at >= sqlc.arg(date_from)
  AND j.started_at < sqlc.arg(date_to)
GROUP BY l.name
ORDER BY job_count DESC, l.name
LIMIT 15;

-- name: DailySummarySales :one
SELECT COUNT(*)::bigint AS sale_count,
       COALESCE(SUM(s.total_amount), 0)::numeric AS sale_total
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND s.status = 'posted'
  AND s.sold_at >= sqlc.arg(date_from)
  AND s.sold_at < sqlc.arg(date_to);

-- name: DailySummaryPurchases :one
SELECT COUNT(*)::bigint AS purchase_count,
       COALESCE(SUM(p.total_amount), 0)::numeric AS purchase_total
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)
  AND p.status = 'posted'
  AND p.purchased_at >= sqlc.arg(date_from)
  AND p.purchased_at < sqlc.arg(date_to);

-- name: DailySummaryExpenses :one
-- Posted expenses for the day, excluding stock purchases (reported separately).
SELECT COUNT(*)::bigint AS expense_count,
       COALESCE(SUM(t.amount), 0)::numeric AS expense_total
FROM finance_transactions t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.type = 'expense'
  AND t.status = 'posted'
  AND t.transaction_date = sqlc.arg(day)::date
  AND COALESCE(t.source_type, '') <> 'purchase';

-- name: DailySummaryAccounts :many
SELECT name, type, currency, current_balance
FROM finance_accounts
WHERE organization_id = $1
  AND deleted_at IS NULL
  AND is_active
ORDER BY is_default DESC, name ASC
LIMIT 10;
