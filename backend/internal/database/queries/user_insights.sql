-- Platform 360° user detail reads. Secrets (token hashes, push tokens, TOTP
-- secrets) are never selected.

-- name: GetUserSecuritySummary :one
SELECT
    u.created_at,
    u.last_login_at,
    u.email_verified_at,
    u.password_set,
    COALESCE((SELECT t.enabled FROM user_totp t WHERE t.user_id = u.id), FALSE)::bool AS totp_enabled,
    (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id)::bigint AS passkey_count,
    (SELECT COUNT(*) FROM organization_members om
        JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
        WHERE om.user_id = u.id)::bigint AS organization_count,
    (SELECT COUNT(*) FROM refresh_tokens r
        WHERE r.user_id = u.id AND r.revoked_at IS NULL AND r.expires_at > NOW())::bigint AS active_session_count,
    (SELECT COUNT(*) FROM push_devices d WHERE d.user_id = u.id AND d.disabled_at IS NULL)::bigint AS push_device_count,
    (SELECT COUNT(*) FROM notifications n
        WHERE n.user_id = u.id AND n.channel = 'inapp' AND n.read_at IS NULL
          AND n.status NOT IN ('cancelled', 'failed'))::bigint AS unread_notification_count
FROM users u
WHERE u.id = $1;

-- name: ListUserMembershipsPaged :many
SELECT o.uuid, o.slug, o.name, o.status, o.access_ends_at, om.role, om.created_at AS joined_at
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = sqlc.arg(user_id)
ORDER BY o.name ASC, o.id ASC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountUserMemberships :one
SELECT COUNT(*)::bigint
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = $1;

-- name: ListUserActiveSessionsPaged :many
-- Refresh tokens rotate on every refresh, so created_at is the last use.
SELECT r.uuid, r.user_agent, r.ip_address, r.created_at, r.expires_at,
       (r.impersonator_user_id IS NOT NULL)::bool AS impersonated,
       o.uuid AS organization_uuid, o.name AS organization_name, o.slug AS organization_slug
FROM refresh_tokens r
LEFT JOIN organizations o ON o.id = r.organization_id
WHERE r.user_id = sqlc.arg(user_id)
  AND r.revoked_at IS NULL
  AND r.expires_at > NOW()
ORDER BY r.created_at DESC, r.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountUserActiveSessions :one
SELECT COUNT(*)::bigint FROM refresh_tokens
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW();

-- name: RevokeAllUserSessions :execrows
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = $1
  AND revoked_at IS NULL;

-- name: ListUserPushDevicesPaged :many
SELECT uuid, platform, device_name, app_version, locale, last_seen_at, disabled_at, disabled_reason, created_at
FROM push_devices
WHERE user_id = sqlc.arg(user_id)
ORDER BY (disabled_at IS NULL) DESC, last_seen_at DESC, id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountUserPushDevices :one
SELECT COUNT(*)::bigint FROM push_devices WHERE user_id = $1;

-- name: DeleteUserPushDeviceByUUID :one
DELETE FROM push_devices
WHERE uuid = sqlc.arg(uuid) AND user_id = sqlc.arg(user_id)
RETURNING platform, device_name;

-- name: ListUserActivityPaged :many
SELECT a.uuid, a.action, a.resource, a.resource_uuid, a.payload, a.created_at,
       o.uuid AS organization_uuid, o.name AS organization_name, o.slug AS organization_slug
FROM activity_events a
LEFT JOIN organizations o ON o.id = a.organization_id
WHERE a.actor_user_id = sqlc.arg(actor_user_id)
  AND (sqlc.narg(organization_id)::bigint IS NULL OR a.organization_id = sqlc.narg(organization_id))
  AND (sqlc.narg(action)::text IS NULL OR a.action = sqlc.narg(action))
  AND (
    sqlc.narg(q)::text IS NULL
    OR a.action ILIKE '%' || sqlc.narg(q) || '%'
    OR a.resource ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountUserActivity :one
SELECT COUNT(*)::bigint FROM activity_events a
WHERE a.actor_user_id = sqlc.arg(actor_user_id)
  AND (sqlc.narg(organization_id)::bigint IS NULL OR a.organization_id = sqlc.narg(organization_id))
  AND (sqlc.narg(action)::text IS NULL OR a.action = sqlc.narg(action))
  AND (
    sqlc.narg(q)::text IS NULL
    OR a.action ILIKE '%' || sqlc.narg(q) || '%'
    OR a.resource ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: ListUserAIUsageByOrganization :many
-- Per membership: the user's own conversations and quota tokens since the
-- start of the current AI period.
SELECT o.uuid, o.slug, o.name,
       (SELECT COUNT(*) FROM ai_conversations c
           WHERE c.organization_id = o.id AND c.user_id = om.user_id AND c.deleted_at IS NULL)::bigint AS conversation_count,
       (SELECT COALESCE(SUM(u.input_tokens + u.output_tokens + u.cache_write_tokens), 0) FROM ai_usage u
           WHERE u.organization_id = o.id AND u.user_id = om.user_id AND u.created_at >= sqlc.arg(since))::bigint AS tokens_since
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = sqlc.arg(user_id)
ORDER BY o.name ASC, o.id ASC
LIMIT 50;
