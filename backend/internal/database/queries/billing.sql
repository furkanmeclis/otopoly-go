-- Plans, feature catalog and subscriptions (spec §3).

-- name: ListBillingFeatures :many
SELECT * FROM billing_features WHERE (sqlc.arg(include_inactive)::boolean OR is_active) ORDER BY sort_order, id;

-- name: UpsertBuiltinFeature :exec
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin)
VALUES (sqlc.arg(key), sqlc.arg(kind), sqlc.arg(unit), sqlc.arg(period), sqlc.arg(label_tr), sqlc.arg(label_en), sqlc.arg(sort_order), TRUE)
ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, unit = EXCLUDED.unit, period = EXCLUDED.period, is_builtin = TRUE;

-- name: CreateDisplayFeature :one
INSERT INTO billing_features (key, kind, label_tr, label_en, sort_order, is_builtin)
VALUES (sqlc.arg(key), 'display', sqlc.arg(label_tr), sqlc.arg(label_en), sqlc.arg(sort_order), FALSE)
RETURNING *;

-- name: UpdateFeatureActive :exec
UPDATE billing_features SET is_active = sqlc.arg(is_active) WHERE id = sqlc.arg(id) AND is_builtin = FALSE;

-- name: ListBillingPlans :many
SELECT * FROM billing_plans
WHERE deleted_at IS NULL AND (sqlc.arg(public_only)::boolean = FALSE OR (is_public AND is_active))
ORDER BY sort_order, id;

-- name: GetBillingPlanByUUID :one
SELECT * FROM billing_plans WHERE uuid = $1 AND deleted_at IS NULL;

-- name: GetBillingPlanByCode :one
SELECT * FROM billing_plans WHERE code = $1 AND deleted_at IS NULL;

-- name: CreateBillingPlan :one
INSERT INTO billing_plans (code, name, description, price_monthly, yearly_pricing, price_yearly, yearly_discount_value,
    trial_days, is_public, is_customizable, badge, sort_order, is_active)
VALUES (sqlc.arg(code), sqlc.arg(name), sqlc.arg(description), sqlc.arg(price_monthly), sqlc.arg(yearly_pricing),
    sqlc.arg(price_yearly), sqlc.arg(yearly_discount_value), sqlc.arg(trial_days), sqlc.arg(is_public),
    sqlc.arg(is_customizable), sqlc.arg(badge), sqlc.arg(sort_order), sqlc.arg(is_active))
RETURNING *;

-- name: UpdateBillingPlan :one
UPDATE billing_plans
SET name = sqlc.arg(name), description = sqlc.arg(description), price_monthly = sqlc.arg(price_monthly),
    yearly_pricing = sqlc.arg(yearly_pricing), price_yearly = sqlc.arg(price_yearly),
    yearly_discount_value = sqlc.arg(yearly_discount_value), trial_days = sqlc.arg(trial_days),
    is_public = sqlc.arg(is_public), is_customizable = sqlc.arg(is_customizable), badge = sqlc.arg(badge),
    sort_order = sqlc.arg(sort_order), is_active = sqlc.arg(is_active)
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteBillingPlan :exec
UPDATE billing_plans SET deleted_at = NOW(), is_active = FALSE WHERE uuid = $1 AND deleted_at IS NULL;

-- name: CountLiveSubscriptionsByPlan :one
SELECT COUNT(*)::bigint FROM billing_subscriptions
WHERE plan_id = $1 AND status IN ('trial', 'active', 'grace', 'read_only');

-- name: ListPlanFeatures :many
SELECT pf.*, f.key, f.kind, f.unit, f.period, f.label_tr, f.label_en
FROM billing_plan_features pf JOIN billing_features f ON f.id = pf.feature_id
WHERE pf.plan_id = $1 ORDER BY f.sort_order, f.id;

-- name: DeletePlanFeatures :exec
DELETE FROM billing_plan_features WHERE plan_id = $1;

-- name: InsertPlanFeature :exec
INSERT INTO billing_plan_features (plan_id, feature_id, value_int, value_bool, display_text, enforcement, tolerance_pct, warn_pct,
    min_value, max_value, step, unit_price)
SELECT sqlc.arg(plan_id), f.id, sqlc.narg(value_int), sqlc.narg(value_bool), sqlc.arg(display_text), sqlc.arg(enforcement),
    sqlc.arg(tolerance_pct), sqlc.arg(warn_pct), sqlc.narg(min_value), sqlc.narg(max_value), sqlc.narg(step), sqlc.narg(unit_price)
FROM billing_features f WHERE f.key = sqlc.arg(feature_key);

-- name: GetLiveSubscription :one
SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid
FROM billing_subscriptions s JOIN billing_plans p ON p.id = s.plan_id
WHERE s.organization_id = $1 AND s.status IN ('trial', 'active', 'grace', 'read_only');

-- name: CreateSubscription :one
INSERT INTO billing_subscriptions (organization_id, plan_id, period, status, starts_at, ends_at, price_paid, source, note, created_by)
VALUES (sqlc.arg(organization_id), sqlc.arg(plan_id), sqlc.arg(period), sqlc.arg(status), sqlc.arg(starts_at), sqlc.arg(ends_at),
    sqlc.arg(price_paid), sqlc.arg(source), sqlc.arg(note), sqlc.narg(created_by))
RETURNING *;

-- name: SetOrganizationAccess :exec
UPDATE organizations SET plan_code = sqlc.arg(plan_code), access_starts_at = sqlc.arg(access_starts_at), access_ends_at = sqlc.arg(access_ends_at)
WHERE id = sqlc.arg(id);

-- name: ListOrganizationIDs :many
SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY id;
