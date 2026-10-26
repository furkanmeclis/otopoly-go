-- name: ListSMSProviderAccounts :many
SELECT * FROM sms_provider_accounts
WHERE organization_id = $1
ORDER BY provider;

-- name: GetSMSProviderAccount :one
SELECT * FROM sms_provider_accounts
WHERE organization_id = sqlc.arg(organization_id) AND provider = sqlc.arg(provider);

-- name: GetActiveSMSProviderAccount :one
SELECT * FROM sms_provider_accounts
WHERE organization_id = $1 AND is_active;

-- name: UpsertSMSProviderAccount :one
-- Connect or update credentials; a changed account is re-checked (status
-- back to unchecked). is_active is set separately (SetSMSProviderAccountActive).
INSERT INTO sms_provider_accounts (
    organization_id, provider, sender, credentials_enc, credential_hints, created_by, updated_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(provider), sqlc.arg(sender), sqlc.arg(credentials_enc),
    sqlc.arg(credential_hints), sqlc.narg(actor_id), sqlc.narg(actor_id)
)
ON CONFLICT (organization_id, provider) DO UPDATE
SET sender = EXCLUDED.sender,
    credentials_enc = EXCLUDED.credentials_enc,
    credential_hints = EXCLUDED.credential_hints,
    updated_by = EXCLUDED.updated_by,
    status = 'unchecked',
    last_error = ''
RETURNING *;

-- name: DeactivateSMSProviderAccounts :exec
-- Clears the active flag of every other account (one active per organization).
UPDATE sms_provider_accounts
SET is_active = FALSE
WHERE organization_id = sqlc.arg(organization_id)
  AND provider <> sqlc.arg(keep_provider)
  AND is_active;

-- name: SetSMSProviderAccountActive :one
UPDATE sms_provider_accounts
SET is_active = sqlc.arg(is_active),
    updated_by = sqlc.narg(actor_id)
WHERE organization_id = sqlc.arg(organization_id) AND provider = sqlc.arg(provider)
RETURNING *;

-- name: SetSMSProviderAccountCheck :one
UPDATE sms_provider_accounts
SET status = sqlc.arg(status),
    last_error = sqlc.arg(last_error),
    last_checked_at = NOW()
WHERE organization_id = sqlc.arg(organization_id) AND provider = sqlc.arg(provider)
RETURNING *;

-- name: DeleteSMSProviderAccount :execrows
DELETE FROM sms_provider_accounts
WHERE organization_id = sqlc.arg(organization_id) AND provider = sqlc.arg(provider);

-- name: SetOutboundMessageDeliveryStatus :exec
-- Provider status and billed parts of an SMS right after the send.
UPDATE outbound_messages
SET delivery_status = sqlc.arg(delivery_status),
    delivery_status_at = NOW(),
    segments = sqlc.narg(segments)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);
