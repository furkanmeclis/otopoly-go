-- Personal data scrubbed when a pending account deletion is anonymized.
-- Business records (jobs, sales, finance, contracts, audit) are never
-- deleted; they keep pointing at the scrubbed users row.

-- name: DeleteRefreshTokensByUser :exec
DELETE FROM refresh_tokens WHERE user_id = $1;

-- name: DeleteOTPCodesForUser :exec
DELETE FROM otp_codes
WHERE user_id = sqlc.arg(user_id) OR lower(email) = lower(sqlc.arg(email)::text);

-- name: DeleteNotificationsForUser :exec
-- Delivered notification copies carry the name / email in body and recipient.
DELETE FROM notifications
WHERE user_id = sqlc.arg(user_id) OR lower(recipient) = lower(sqlc.arg(email)::text);

-- name: DeleteNotificationPreferencesByUser :exec
DELETE FROM notification_preferences WHERE user_id = $1;

-- name: DeleteNotificationTypePreferencesByUser :exec
DELETE FROM notification_type_preferences WHERE user_id = $1;

-- name: DeleteNotificationMemberSettingsByUser :exec
-- Member phone numbers used by the notification center.
DELETE FROM notification_member_settings WHERE user_id = $1;

-- name: DeleteScheduledNotificationsForUser :exec
-- Reminders not yet sent to the user.
DELETE FROM scheduled_notifications
WHERE recipient_user_id = $1 AND status = 'pending';

-- name: DeleteAIConversationsByUser :exec
-- Assistant chats are personal; messages cascade.
DELETE FROM ai_conversations WHERE user_id = $1;

-- name: DeleteMCPGrantsByUser :exec
-- Remote MCP connector grants (tokens cascade).
DELETE FROM mcp_oauth_grants WHERE user_id = $1;

-- name: ScrubActivityEventNetworkByActor :exec
-- Audit rows stay; the user's IP address and user agent are removed.
UPDATE activity_events
SET ip_address = NULL, user_agent = NULL
WHERE actor_user_id = $1;

-- name: ListOwnedOrganizationsByUser :many
-- Organizations the user owns, with how many other members remain.
SELECT o.id, o.uuid, o.slug, o.name,
       (SELECT COUNT(*) FROM organization_members other
        JOIN users ou ON ou.id = other.user_id AND ou.deleted_at IS NULL
        WHERE other.organization_id = o.id AND other.user_id <> om.user_id)::bigint AS other_members,
       (SELECT COUNT(*) FROM organization_members other
        JOIN users ou ON ou.id = other.user_id AND ou.deleted_at IS NULL
        WHERE other.organization_id = o.id AND other.user_id <> om.user_id AND other.role = 'owner')::bigint AS other_owners
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = $1 AND om.role = 'owner'
ORDER BY o.name ASC;
