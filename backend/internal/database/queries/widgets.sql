-- Home / Lock Screen widget snapshot (modules/livepush): small org-scoped
-- counts and the next agenda items. Each is cheap and indexed.

-- name: ListPermissionSlugsForUsers :many
-- Effective permission slugs of several users (union of their roles).
SELECT DISTINCT ur.user_id, p.slug
FROM user_roles ur
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.user_id = ANY (sqlc.arg(user_ids)::bigint[])
ORDER BY ur.user_id, p.slug;

-- name: WidgetLowStockCount :one
-- Active stock-tracked products at or below their minimum.
SELECT COUNT(*)::bigint
FROM products
WHERE organization_id = sqlc.arg(organization_id)
  AND deleted_at IS NULL
  AND is_active
  AND track_stock
  AND min_stock_alert > 0
  AND stock_quantity <= min_stock_alert;

-- name: WidgetReviewFollowUpCount :one
-- Answered reviews that still wait for a follow-up call.
SELECT COUNT(*)::bigint
FROM review_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND kind = 'job'
  AND follow_up_status = 'required';

-- name: WidgetUnpaidDeliveredCount :one
-- Jobs delivered in [day_start, day_end) that nobody has been paid for yet.
SELECT COUNT(*)::bigint
FROM service_jobs
WHERE organization_id = sqlc.arg(organization_id)
  AND status = 'delivered'
  AND payment_status = 'unpaid'
  AND delivered_at >= sqlc.arg(day_start)
  AND delivered_at < sqlc.arg(day_end);

-- name: WidgetAgendaEvents :many
-- Calendar events of the day that have not ended yet (all-day ones included).
SELECT uuid, title, starts_at, ends_at, all_day
FROM calendar_events
WHERE organization_id = sqlc.arg(organization_id)
  AND deleted_at IS NULL
  AND starts_at < sqlc.arg(day_end)
  AND ends_at > sqlc.arg(now_at)
ORDER BY all_day ASC, starts_at, id
LIMIT sqlc.arg(limit_count);

-- name: WidgetAgendaTodos :many
-- Open to-dos due on the day: timed ones not yet past, then untimed ones.
SELECT uuid, title, due_time
FROM todos
WHERE organization_id = sqlc.arg(organization_id)
  AND status = 'open'
  AND due_date = sqlc.arg(day)::date
  AND (due_time IS NULL OR due_time >= sqlc.arg(after_time)::time)
ORDER BY due_time NULLS LAST, id
LIMIT sqlc.arg(limit_count);
