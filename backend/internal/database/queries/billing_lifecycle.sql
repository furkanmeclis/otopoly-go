-- Billing lifecycle transitions, reminder idempotency and dashboard queries.

-- name: ListSubscriptionsToGrace :many
SELECT s.*, p.code AS plan_code, o.slug AS organization_slug, o.name AS organization_name
FROM billing_subscriptions s
JOIN billing_plans p ON p.id = s.plan_id
JOIN organizations o ON o.id = s.organization_id
WHERE s.status IN ('trial', 'active') AND s.ends_at <= sqlc.arg(now_at)
ORDER BY s.ends_at ASC, s.id ASC;

-- name: ListSubscriptionsToReadOnly :many
SELECT s.*, p.code AS plan_code, o.slug AS organization_slug, o.name AS organization_name
FROM billing_subscriptions s
JOIN billing_plans p ON p.id = s.plan_id
JOIN organizations o ON o.id = s.organization_id
WHERE s.status = 'grace' AND s.grace_ends_at <= sqlc.arg(now_at)
ORDER BY s.grace_ends_at ASC, s.id ASC;

-- name: MoveToGrace :one
UPDATE billing_subscriptions
SET status = 'grace',
    grace_ends_at = sqlc.arg(grace_ends_at),
    note = CASE
        WHEN note = '' THEN 'lifecycle: moved to grace'
        ELSE note || E'\n' || 'lifecycle: moved to grace'
    END
WHERE id = sqlc.arg(id) AND status IN ('trial', 'active')
RETURNING *;

-- name: MoveToReadOnly :one
UPDATE billing_subscriptions
SET status = 'read_only',
    note = CASE
        WHEN note = '' THEN 'lifecycle: moved to read_only'
        ELSE note || E'\n' || 'lifecycle: moved to read_only'
    END
WHERE id = sqlc.arg(id) AND status IN ('trial', 'active', 'grace')
RETURNING *;

-- name: ClearOrganizationAccessEnd :exec
UPDATE organizations
SET access_ends_at = NULL
WHERE id = $1;

-- name: ListSubscriptionsEndingOn :many
SELECT s.*, p.code AS plan_code, o.slug AS organization_slug, o.name AS organization_name
FROM billing_subscriptions s
JOIN billing_plans p ON p.id = s.plan_id
JOIN organizations o ON o.id = s.organization_id
WHERE s.status IN ('trial', 'active')
  AND s.ends_at >= sqlc.arg(day_start)
  AND s.ends_at < sqlc.arg(day_end)
ORDER BY s.ends_at ASC, s.id ASC;

-- name: ListOrdersExpiringWithin :many
SELECT o.*, org.slug AS organization_slug, org.name AS organization_name
FROM billing_orders o
JOIN organizations org ON org.id = o.organization_id
WHERE o.status IN ('pending_payment', 'payment_reported')
  AND o.expires_at > sqlc.arg(now_at)
  AND o.expires_at <= sqlc.arg(until_at)
ORDER BY o.expires_at ASC, o.id ASC;

-- name: InsertReminderLog :execrows
INSERT INTO billing_reminder_log (key, kind, organization_id)
VALUES (sqlc.arg(key), sqlc.arg(kind), sqlc.narg(organization_id))
ON CONFLICT (key) DO NOTHING;

-- name: BillingSubscriptionStatusCounts :one
SELECT
    COUNT(*) FILTER (WHERE latest.status = 'trial')::bigint AS trial,
    COUNT(*) FILTER (WHERE latest.status = 'active')::bigint AS active,
    COUNT(*) FILTER (WHERE latest.status = 'grace')::bigint AS grace,
    COUNT(*) FILTER (WHERE latest.status = 'read_only')::bigint AS read_only
FROM (
    SELECT DISTINCT ON (organization_id) *
    FROM billing_subscriptions
    WHERE status IN ('trial', 'active', 'grace', 'read_only')
    ORDER BY organization_id, created_at DESC, id DESC
) latest;

-- name: BillingPlanDistribution :many
SELECT p.code, p.name, COUNT(*)::bigint AS count
FROM (
    SELECT DISTINCT ON (organization_id) *
    FROM billing_subscriptions
    WHERE status IN ('trial', 'active', 'grace', 'read_only')
    ORDER BY organization_id, created_at DESC, id DESC
) latest
JOIN billing_plans p ON p.id = latest.plan_id
GROUP BY p.code, p.name
ORDER BY count DESC, p.name ASC;

-- name: BillingApprovedThisMonth :one
SELECT COUNT(*)::bigint AS count, COALESCE(SUM(total), 0)::numeric AS amount
FROM billing_orders
WHERE status = 'approved'
  AND reviewed_at >= sqlc.arg(month_start)
  AND reviewed_at < sqlc.arg(month_end);

-- name: BillingExpiringCounts :one
SELECT
    COUNT(*) FILTER (WHERE ends_at > sqlc.arg(now_at) AND ends_at <= sqlc.arg(within_7))::bigint AS within_7,
    COUNT(*) FILTER (WHERE ends_at > sqlc.arg(now_at) AND ends_at <= sqlc.arg(within_30))::bigint AS within_30
FROM (
    SELECT DISTINCT ON (organization_id) *
    FROM billing_subscriptions
    WHERE status IN ('trial', 'active')
    ORDER BY organization_id, created_at DESC, id DESC
) latest;

-- name: BillingTrialConversion :one
SELECT
    COUNT(*) FILTER (WHERE status = 'trial' AND created_at >= sqlc.arg(since_at))::bigint AS trials_90d,
    COUNT(DISTINCT organization_id) FILTER (WHERE status = 'active' AND created_at >= sqlc.arg(since_at))::bigint AS converted_90d
FROM billing_subscriptions;

-- name: BillingDiscountSummaries :many
SELECT d.code,
    COUNT(u.id)::bigint AS uses,
    COALESCE(SUM(u.amount), 0)::numeric AS discount_total,
    COALESCE(SUM(o.total), 0)::numeric AS revenue
FROM billing_discount_codes d
JOIN billing_discount_uses u ON u.discount_code_id = d.id
JOIN billing_orders o ON o.id = u.order_id
GROUP BY d.code
ORDER BY uses DESC, d.code ASC
LIMIT 10;

-- name: ListSubscriptionHistoryForOrg :many
SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_subscriptions s
JOIN billing_plans p ON p.id = s.plan_id
JOIN organizations org ON org.id = s.organization_id
WHERE s.organization_id = $1
ORDER BY s.created_at DESC, s.id DESC;

-- name: ListOrdersForOrgAdmin :many
SELECT o.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_orders o
JOIN billing_plans p ON p.id = o.plan_id
JOIN organizations org ON org.id = o.organization_id
WHERE o.organization_id = $1
ORDER BY o.created_at DESC, o.id DESC
LIMIT 50;

-- name: ListInvoicesForOrgAdmin :many
SELECT i.*, o.uuid AS order_uuid, o.reference_code AS order_reference,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
JOIN organizations org ON org.id = i.organization_id
WHERE i.organization_id = $1
ORDER BY i.created_at DESC, i.id DESC
LIMIT 50;

-- name: ListUsageMetersForOrgAdmin :many
SELECT c.feature_key, c.period_key, c.value, c.updated_at,
    f.kind, f.unit, f.period, f.label_tr, f.label_en
FROM billing_usage_counters c
LEFT JOIN billing_features f ON f.key = c.feature_key
WHERE c.organization_id = $1
ORDER BY c.feature_key ASC, c.period_key DESC;
