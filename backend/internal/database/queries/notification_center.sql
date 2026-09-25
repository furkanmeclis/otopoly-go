-- name: InsertScheduledNotification :one
-- Inserts a notification slot. A conflicting cancelled row is revived (a
-- reschedule back to the same slot); any other conflict returns no row, which
-- the caller treats as a duplicate.
INSERT INTO scheduled_notifications (
    organization_id, kind, subject_type, subject_id, recipient_user_id, recipient_customer_id,
    recipient_phone, recipient_email, channels, locale, vars, attachment, action_url,
    fire_at, next_attempt_at, max_attempts, dedupe_key, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(kind), sqlc.arg(subject_type), sqlc.arg(subject_id),
    sqlc.narg(recipient_user_id), sqlc.narg(recipient_customer_id), sqlc.arg(recipient_phone),
    sqlc.arg(recipient_email), sqlc.arg(channels)::text[], sqlc.arg(locale), sqlc.arg(vars),
    sqlc.narg(attachment), sqlc.arg(action_url), sqlc.arg(fire_at), sqlc.arg(fire_at),
    sqlc.arg(max_attempts), sqlc.arg(dedupe_key), sqlc.narg(created_by)
)
ON CONFLICT (organization_id, dedupe_key) DO UPDATE
SET status = 'pending',
    channels = EXCLUDED.channels,
    locale = EXCLUDED.locale,
    vars = EXCLUDED.vars,
    attachment = EXCLUDED.attachment,
    action_url = EXCLUDED.action_url,
    fire_at = EXCLUDED.fire_at,
    next_attempt_at = EXCLUDED.next_attempt_at,
    attempts = 0,
    delivered_channels = '{}',
    last_error = '',
    cancelled_at = NULL,
    locked_at = NULL
WHERE scheduled_notifications.status = 'cancelled'
RETURNING *;

-- name: GetScheduledNotificationByKey :one
SELECT * FROM scheduled_notifications
WHERE organization_id = sqlc.arg(organization_id) AND dedupe_key = sqlc.arg(dedupe_key);

-- name: ClaimDueScheduledNotifications :many
-- Atomic batch claim; concurrent sweepers skip each other's rows.
UPDATE scheduled_notifications s
SET status = 'processing', locked_at = now(), attempts = s.attempts + 1
WHERE s.id IN (
    SELECT c.id FROM scheduled_notifications c
    WHERE c.status = 'pending' AND c.next_attempt_at <= sqlc.arg(now)::timestamptz
    ORDER BY c.next_attempt_at, c.id
    LIMIT sqlc.arg(limit_count)
    FOR UPDATE SKIP LOCKED
)
RETURNING s.*;

-- name: ClaimScheduledNotificationByID :one
UPDATE scheduled_notifications
SET status = 'processing', locked_at = now(), attempts = attempts + 1
WHERE id = sqlc.arg(id) AND status = 'pending'
RETURNING *;

-- name: MarkScheduledNotificationSent :one
UPDATE scheduled_notifications
SET status = 'sent', sent_at = now(), locked_at = NULL,
    delivered_channels = sqlc.arg(delivered_channels)::text[], last_error = sqlc.arg(last_error)
WHERE id = sqlc.arg(id) AND status = 'processing'
RETURNING *;

-- name: MarkScheduledNotificationRetry :one
-- Back to pending with backoff, or failed once max_attempts is reached.
UPDATE scheduled_notifications
SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
    next_attempt_at = sqlc.arg(next_attempt_at),
    delivered_channels = sqlc.arg(delivered_channels)::text[],
    last_error = sqlc.arg(last_error),
    locked_at = NULL
WHERE id = sqlc.arg(id) AND status = 'processing'
RETURNING *;

-- name: MarkScheduledNotificationCancelled :one
UPDATE scheduled_notifications
SET status = 'cancelled', cancelled_at = now(), locked_at = NULL, last_error = sqlc.arg(last_error)
WHERE id = sqlc.arg(id) AND status IN ('pending', 'processing')
RETURNING *;

-- name: ReleaseStuckScheduledNotifications :execrows
UPDATE scheduled_notifications
SET status = 'pending', locked_at = NULL
WHERE status = 'processing' AND locked_at < sqlc.arg(stale_before)::timestamptz;

-- name: CancelScheduledNotificationsBySubject :execrows
UPDATE scheduled_notifications
SET status = 'cancelled', cancelled_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND subject_type = sqlc.arg(subject_type)
  AND subject_id = sqlc.arg(subject_id)
  AND status = 'pending';

-- name: ListScheduledNotificationsBySubject :many
SELECT * FROM scheduled_notifications
WHERE organization_id = sqlc.arg(organization_id)
  AND subject_type = sqlc.arg(subject_type)
  AND subject_id = sqlc.arg(subject_id)
ORDER BY fire_at, id;

-- name: ListPendingRemindersForSubjects :many
-- Pending reminder fire times for a page of subjects (no N+1 in lists).
SELECT subject_id, fire_at FROM scheduled_notifications
WHERE organization_id = sqlc.arg(organization_id)
  AND subject_type = sqlc.arg(subject_type)
  AND subject_id = ANY(sqlc.arg(subject_ids)::bigint[])
  AND status = 'pending'
ORDER BY subject_id, fire_at;

-- name: ListNotificationTypePreferences :many
SELECT * FROM notification_type_preferences
WHERE user_id = sqlc.arg(user_id) AND organization_id = sqlc.arg(organization_id)
ORDER BY notification_type;

-- name: GetNotificationTypePreference :one
SELECT * FROM notification_type_preferences
WHERE user_id = sqlc.arg(user_id) AND organization_id = sqlc.arg(organization_id)
  AND notification_type = sqlc.arg(notification_type);

-- name: UpsertNotificationTypePreference :one
INSERT INTO notification_type_preferences (
    user_id, organization_id, notification_type, inapp_enabled, email_enabled, whatsapp_enabled, sms_enabled
) VALUES (
    sqlc.arg(user_id), sqlc.arg(organization_id), sqlc.arg(notification_type), sqlc.arg(inapp_enabled),
    sqlc.arg(email_enabled), sqlc.arg(whatsapp_enabled), sqlc.arg(sms_enabled)
)
ON CONFLICT (user_id, organization_id, notification_type) DO UPDATE
SET inapp_enabled = EXCLUDED.inapp_enabled,
    email_enabled = EXCLUDED.email_enabled,
    whatsapp_enabled = EXCLUDED.whatsapp_enabled,
    sms_enabled = EXCLUDED.sms_enabled
RETURNING *;

-- name: GetNotificationMemberSettings :one
SELECT * FROM notification_member_settings
WHERE user_id = sqlc.arg(user_id) AND organization_id = sqlc.arg(organization_id);

-- name: UpsertNotificationMemberSettings :one
INSERT INTO notification_member_settings (user_id, organization_id, phone)
VALUES (sqlc.arg(user_id), sqlc.arg(organization_id), sqlc.arg(phone))
ON CONFLICT (user_id, organization_id) DO UPDATE SET phone = EXCLUDED.phone
RETURNING *;

-- name: GetNotificationRecipientUser :one
-- A member of the organization (tenant isolation for user recipients).
SELECT u.id, u.uuid, u.email, u.name, u.surname, u.locale
FROM organization_members om
JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = sqlc.arg(organization_id) AND u.id = sqlc.arg(user_id);

-- name: GetNotificationRecipientCustomer :one
SELECT id, uuid, name, phone, email
FROM customers
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: GetNotificationOrganization :one
SELECT id, uuid, slug, name, phone FROM organizations WHERE id = sqlc.arg(id);
