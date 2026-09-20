-- name: GetWhatsAppSession :one
SELECT * FROM whatsapp_sessions
WHERE organization_id = $1;

-- name: ListConnectedWhatsAppSessions :many
SELECT * FROM whatsapp_sessions
WHERE status = 'connected' AND jid <> ''
ORDER BY organization_id;


-- name: UpsertWhatsAppSession :one
INSERT INTO whatsapp_sessions (
    organization_id, status, jid, phone_number, display_name,
    encrypted_keys, last_seen_at, error_message, qr_code, qr_expires_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
ON CONFLICT (organization_id) DO UPDATE
SET
    status         = EXCLUDED.status,
    jid            = EXCLUDED.jid,
    phone_number   = EXCLUDED.phone_number,
    display_name   = EXCLUDED.display_name,
    encrypted_keys = EXCLUDED.encrypted_keys,
    last_seen_at   = EXCLUDED.last_seen_at,
    error_message  = EXCLUDED.error_message,
    qr_code        = EXCLUDED.qr_code,
    qr_expires_at  = EXCLUDED.qr_expires_at
RETURNING *;

-- name: UpdateWhatsAppSessionQR :one
UPDATE whatsapp_sessions
SET status = 'qr_pending',
    qr_code = $2,
    qr_expires_at = $3,
    error_message = ''
WHERE organization_id = $1
RETURNING *;

-- name: UpsertNotificationRule :one
INSERT INTO notification_rules (
    organization_id, event_type, channel, enabled
) VALUES (
    $1, $2, $3, $4
)
ON CONFLICT (organization_id, event_type, channel) DO UPDATE
SET enabled = EXCLUDED.enabled
RETURNING *;

-- name: ListNotificationRulesByOrg :many
SELECT * FROM notification_rules
WHERE organization_id = $1
ORDER BY event_type, channel;

-- name: GetNotificationRule :one
SELECT * FROM notification_rules
WHERE organization_id = $1 AND event_type = $2 AND channel = $3;

-- name: UpsertMessageTemplate :one
INSERT INTO message_templates (
    organization_id, event_type, channel, locale, subject, body, variables, is_active
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (organization_id, event_type, channel, locale) DO UPDATE
SET
    subject    = EXCLUDED.subject,
    body       = EXCLUDED.body,
    variables  = EXCLUDED.variables,
    is_active  = EXCLUDED.is_active
RETURNING *;

-- name: ListMessageTemplatesByOrg :many
SELECT * FROM message_templates
WHERE organization_id = $1
ORDER BY event_type, channel, locale;

-- name: GetMessageTemplate :one
SELECT * FROM message_templates
WHERE uuid = $1 AND organization_id = $2;

-- name: GetMessageTemplateByKey :one
SELECT * FROM message_templates
WHERE organization_id = $1
  AND event_type = $2
  AND channel = $3
  AND locale = $4
  AND is_active = true;

-- name: DeleteMessageTemplate :exec
DELETE FROM message_templates
WHERE uuid = $1 AND organization_id = $2;

-- name: InsertOutboundMessage :one
INSERT INTO outbound_messages (
    organization_id, event_type, channel, recipient_phone,
    status, payload, subject_type, subject_uuid
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: UpdateOutboundMessageStatus :one
UPDATE outbound_messages
SET
    status             = $2,
    provider_reference = $3,
    error_message      = $4,
    sent_at            = $5
WHERE id = $1
RETURNING *;
