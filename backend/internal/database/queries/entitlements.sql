-- Effective feature values and usage counters for platform/entitlements.

-- name: GetEffectiveFeatures :many
-- Plan values of the organization's live subscription plus the custom
-- override JSON (enterprise, F5). Missing rows mean "unlimited / enabled".
SELECT f.key, f.kind, f.period, pf.value_int, pf.value_bool, pf.enforcement, pf.tolerance_pct, pf.warn_pct,
       COALESCE(s.custom_features ->> f.key, '')::text AS custom_value
FROM billing_subscriptions s
JOIN billing_plan_features pf ON pf.plan_id = s.plan_id
JOIN billing_features f ON f.id = pf.feature_id AND f.is_active
WHERE s.organization_id = $1 AND s.status IN ('trial', 'active', 'grace', 'read_only');

-- name: GetUsageCounter :one
SELECT COALESCE((SELECT value FROM billing_usage_counters WHERE organization_id = $1 AND feature_key = $2 AND period_key = $3), 0)::bigint AS value;

-- name: ConsumeUsage :one
INSERT INTO billing_usage_counters (organization_id, feature_key, period_key, value)
VALUES ($1, $2, $3, GREATEST(0, sqlc.arg(delta)::bigint))
ON CONFLICT (organization_id, feature_key, period_key)
DO UPDATE SET value = GREATEST(0, billing_usage_counters.value + sqlc.arg(delta)::bigint), updated_at = NOW()
RETURNING value;

-- name: SetUsageCounter :exec
INSERT INTO billing_usage_counters (organization_id, feature_key, period_key, value)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, feature_key, period_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- name: ListUsageCounters :many
SELECT feature_key, period_key, value FROM billing_usage_counters
WHERE organization_id = $1 AND period_key = ANY(sqlc.arg(period_keys)::text[]);

-- name: CountActiveJobsInRange :one
SELECT COUNT(*)::bigint FROM service_jobs
WHERE organization_id = $1 AND status NOT IN ('cancelled', 'voided')
  AND started_at >= sqlc.arg(from_at) AND started_at < sqlc.arg(to_at);

-- name: CountOrgMembers :one
SELECT COUNT(*)::bigint FROM organization_members om JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = $1;

-- name: CountOrgCustomers :one
SELECT COUNT(*)::bigint FROM customers WHERE organization_id = $1 AND deleted_at IS NULL;
