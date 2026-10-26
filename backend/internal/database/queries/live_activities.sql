-- Live Activity / Live Update push tokens and widget refresh devices
-- (modules/livepush). Every query is scoped by organization_id except the
-- global expiry sweep.

-- name: UpsertLiveActivityToken :one
-- Re-registering (token rotation, relaunch) refreshes the row; an activity id
-- never moves between organizations (no row comes back → conflict).
INSERT INTO live_activity_tokens (
    organization_id, user_id, job_id, platform, activity_id, push_token, device_token, locale, expires_at
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(user_id), sqlc.arg(job_id), sqlc.arg(platform), sqlc.arg(activity_id),
    sqlc.arg(push_token), sqlc.arg(device_token), sqlc.arg(locale), sqlc.arg(expires_at)
)
ON CONFLICT (user_id, platform, activity_id, device_token) DO UPDATE SET
    job_id = EXCLUDED.job_id,
    push_token = EXCLUDED.push_token,
    locale = EXCLUDED.locale,
    expires_at = EXCLUDED.expires_at
WHERE live_activity_tokens.organization_id = EXCLUDED.organization_id
RETURNING *;

-- name: DeleteLiveActivityTokensForUser :execrows
DELETE FROM live_activity_tokens
WHERE organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND job_id = sqlc.arg(job_id)
  AND (sqlc.narg(activity_id)::text IS NULL OR activity_id = sqlc.narg(activity_id))
  AND (sqlc.narg(device_token)::text IS NULL OR device_token = sqlc.narg(device_token));

-- name: ListLiveActivityTargetsForJob :many
-- Only members who still belong to an organization that is not suspended.
-- device_id is the active push device behind an Android row (0 = gone).
SELECT t.id, t.uuid, t.organization_id, t.user_id, t.job_id, t.platform, t.activity_id,
       t.push_token, t.device_token, t.locale, t.last_status, t.last_hash, t.expires_at,
       u.locale AS user_locale,
       COALESCE(pd.id, 0)::bigint AS device_id
FROM live_activity_tokens t
JOIN users u ON u.id = t.user_id
JOIN organization_members m ON m.organization_id = t.organization_id AND m.user_id = t.user_id
JOIN organizations o ON o.id = t.organization_id
LEFT JOIN push_devices pd ON pd.token = t.device_token AND pd.user_id = t.user_id AND pd.disabled_at IS NULL
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.job_id = sqlc.arg(job_id)
  AND t.expires_at > NOW()
  AND o.status <> 'suspended'
ORDER BY t.id;

-- name: MarkLiveActivityTokenSent :exec
UPDATE live_activity_tokens
SET last_status = sqlc.arg(last_status),
    last_hash = sqlc.arg(last_hash),
    last_sent_at = NOW()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: DeleteLiveActivityToken :exec
DELETE FROM live_activity_tokens
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: DeleteExpiredLiveActivityTokens :execrows
-- Maintenance sweep across organizations (rows past their activity lifetime).
DELETE FROM live_activity_tokens WHERE expires_at <= NOW();

-- name: GetActivePushDeviceForUser :one
SELECT * FROM push_devices
WHERE user_id = sqlc.arg(user_id) AND token = sqlc.arg(token) AND disabled_at IS NULL;

-- name: UpsertLiveActivityDevice :one
-- The device follows the app's active organization and its current user.
INSERT INTO live_activity_devices (organization_id, user_id, push_device_id, push_to_start_token, widgets_enabled)
VALUES (sqlc.arg(organization_id), sqlc.arg(user_id), sqlc.arg(push_device_id), sqlc.arg(push_to_start_token), sqlc.arg(widgets_enabled))
ON CONFLICT (push_device_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    user_id = EXCLUDED.user_id,
    push_to_start_token = EXCLUDED.push_to_start_token,
    widgets_enabled = EXCLUDED.widgets_enabled
RETURNING *;

-- name: DeleteLiveActivityDeviceForUser :execrows
DELETE FROM live_activity_devices
WHERE organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND push_device_id = sqlc.arg(push_device_id);

-- name: ListWidgetRefreshTargets :many
-- Active devices showing this organization's widgets, owned by current members.
SELECT d.id, d.user_id, pd.id AS push_device_id, pd.token, pd.platform
FROM live_activity_devices d
JOIN push_devices pd ON pd.id = d.push_device_id AND pd.user_id = d.user_id AND pd.disabled_at IS NULL
JOIN organization_members m ON m.organization_id = d.organization_id AND m.user_id = d.user_id
JOIN organizations o ON o.id = d.organization_id
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.widgets_enabled
  AND o.status <> 'suspended'
ORDER BY d.id;

-- name: LastWidgetPushAt :one
SELECT COALESCE(MAX(last_widget_push_at), 'epoch'::timestamptz)::timestamptz AS last_at
FROM live_activity_devices
WHERE organization_id = sqlc.arg(organization_id);

-- name: MarkWidgetPushSent :exec
UPDATE live_activity_devices
SET last_widget_push_at = NOW()
WHERE organization_id = sqlc.arg(organization_id) AND widgets_enabled;
