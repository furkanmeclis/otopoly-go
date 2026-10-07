-- name: GetPlatformWhatsAppSettings :one
SELECT * FROM platform_whatsapp_settings WHERE id = 1;

-- name: UpdatePlatformWhatsAppSettings :one
-- Partial update: NULL args keep the stored value.
UPDATE platform_whatsapp_settings
SET provider = COALESCE(sqlc.narg(provider), provider),
    app_id = COALESCE(sqlc.narg(app_id), app_id),
    waba_id = COALESCE(sqlc.narg(waba_id), waba_id),
    phone_number_id = COALESCE(sqlc.narg(phone_number_id), phone_number_id),
    api_version = COALESCE(sqlc.narg(api_version), api_version),
    access_token_enc = COALESCE(sqlc.narg(access_token_enc), access_token_enc),
    app_secret_enc = COALESCE(sqlc.narg(app_secret_enc), app_secret_enc),
    webhook_verify_token_enc = COALESCE(sqlc.narg(webhook_verify_token_enc), webhook_verify_token_enc),
    display_phone = COALESCE(sqlc.narg(display_phone), display_phone),
    updated_by = sqlc.narg(updated_by)
WHERE id = 1
RETURNING *;

-- name: UpdatePlatformWhatsAppSession :one
-- Connected / disconnected / pairing state; always clears the QR code.
UPDATE platform_whatsapp_settings
SET wm_status = sqlc.arg(wm_status),
    wm_jid = sqlc.arg(wm_jid),
    wm_phone = sqlc.arg(wm_phone),
    wm_error = sqlc.arg(wm_error),
    wm_qr_code = '',
    wm_qr_expires_at = NULL
WHERE id = 1
RETURNING *;

-- name: UpdatePlatformWhatsAppQR :one
UPDATE platform_whatsapp_settings
SET wm_status = 'qr_pending',
    wm_qr_code = sqlc.arg(wm_qr_code),
    wm_qr_expires_at = sqlc.arg(wm_qr_expires_at),
    wm_error = ''
WHERE id = 1
RETURNING *;

-- name: ListWhatsAppCloudTemplates :many
SELECT * FROM whatsapp_cloud_templates ORDER BY key;

-- name: GetWhatsAppCloudTemplateByKey :one
SELECT * FROM whatsapp_cloud_templates WHERE key = sqlc.arg(key);

-- name: EnsureWhatsAppCloudTemplate :one
-- Inserts a catalog entry; existing rows keep their Meta state and override.
INSERT INTO whatsapp_cloud_templates (key, meta_name, language, category)
VALUES (sqlc.arg(key), sqlc.arg(meta_name), sqlc.arg(language), sqlc.arg(category))
ON CONFLICT (key) DO UPDATE
SET meta_name = EXCLUDED.meta_name,
    language = EXCLUDED.language,
    category = EXCLUDED.category
RETURNING *;

-- name: SetWhatsAppCloudTemplateOverride :one
UPDATE whatsapp_cloud_templates
SET override_name = sqlc.narg(override_name)
WHERE key = sqlc.arg(key)
RETURNING *;

-- name: UpdateWhatsAppCloudTemplateStatus :one
UPDATE whatsapp_cloud_templates
SET status = sqlc.arg(status),
    meta_template_id = sqlc.arg(meta_template_id),
    rejected_reason = sqlc.arg(rejected_reason),
    last_synced_at = NOW()
WHERE key = sqlc.arg(key)
RETURNING *;

-- name: UpdateWhatsAppCloudTemplateStatusByMetaID :execrows
UPDATE whatsapp_cloud_templates
SET status = sqlc.arg(status),
    rejected_reason = sqlc.arg(rejected_reason),
    last_synced_at = NOW()
WHERE meta_template_id = sqlc.arg(meta_template_id) AND meta_template_id <> '';

-- name: SetWhatsAppSessionFallback :one
INSERT INTO whatsapp_sessions (organization_id, fallback_to_platform)
VALUES (sqlc.arg(organization_id), sqlc.arg(fallback_to_platform))
ON CONFLICT (organization_id) DO UPDATE
SET fallback_to_platform = EXCLUDED.fallback_to_platform
RETURNING *;

-- name: SetOutboundMessageSender :exec
-- Sender route of the latest attempt (error_code NULL on success).
UPDATE outbound_messages
SET sender_kind = sqlc.narg(sender_kind),
    template_name = sqlc.narg(template_name),
    error_code = sqlc.narg(error_code)
WHERE id = sqlc.arg(id);

-- name: SetOutboundMessageErrorCode :exec
UPDATE outbound_messages
SET error_code = sqlc.narg(error_code)
WHERE id = sqlc.arg(id);

-- name: GetOutboundMessageByProviderReference :one
SELECT * FROM outbound_messages
WHERE provider_reference = sqlc.arg(provider_reference) AND provider_reference <> ''
ORDER BY id DESC
LIMIT 1;

-- name: ApplyOutboundDeliveryStatus :execrows
-- Webhook status of a wamid. sent < delivered < read never regress (a late
-- "delivered" after "read" keeps "read"); "failed" always applies (with its
-- error code) and later non-failed statuses do not override it. Pricing is
-- recorded whatever the order. Atomic, idempotent; unknown wamid → 0 rows.
UPDATE outbound_messages
SET delivery_status = CASE
        WHEN sqlc.arg(delivery_status)::text = 'failed'
             AND delivery_status IS DISTINCT FROM 'failed' THEN 'failed'
        WHEN sqlc.arg(delivery_status)::text <> 'failed'
             AND delivery_status IS DISTINCT FROM 'failed'
             AND (CASE delivery_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
               < (CASE sqlc.arg(delivery_status)::text WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
            THEN sqlc.arg(delivery_status)::text
        ELSE delivery_status
    END,
    delivery_status_at = CASE
        WHEN sqlc.arg(delivery_status)::text = 'failed'
             AND delivery_status IS DISTINCT FROM 'failed' THEN sqlc.arg(delivery_status_at)
        WHEN sqlc.arg(delivery_status)::text <> 'failed'
             AND delivery_status IS DISTINCT FROM 'failed'
             AND (CASE delivery_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
               < (CASE sqlc.arg(delivery_status)::text WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
            THEN sqlc.arg(delivery_status_at)
        ELSE delivery_status_at
    END,
    error_code = CASE
        WHEN sqlc.arg(delivery_status)::text = 'failed'
             AND delivery_status IS DISTINCT FROM 'failed' THEN COALESCE(sqlc.narg(error_code), error_code)
        ELSE error_code
    END,
    pricing_category = COALESCE(sqlc.narg(pricing_category), pricing_category),
    billable = COALESCE(sqlc.narg(billable), billable)
WHERE provider_reference = sqlc.arg(provider_reference) AND provider_reference <> '';

-- name: UpdateWhatsAppCloudTemplateStatusByName :execrows
-- Webhook fallback when the Meta template id is not stored yet: match the
-- effective name (override or catalog name) and language.
UPDATE whatsapp_cloud_templates
SET status = sqlc.arg(status),
    rejected_reason = sqlc.arg(rejected_reason),
    meta_template_id = CASE WHEN sqlc.arg(meta_template_id)::text <> '' THEN sqlc.arg(meta_template_id)::text ELSE meta_template_id END,
    last_synced_at = NOW()
WHERE COALESCE(NULLIF(BTRIM(override_name), ''), meta_name) = sqlc.arg(name)::text
  AND language = sqlc.arg(language);

-- name: ListOutboundMessagesByOrg :many
SELECT * FROM outbound_messages
WHERE organization_id = sqlc.arg(organization_id)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountOutboundMessagesByOrg :one
SELECT COUNT(*) FROM outbound_messages WHERE organization_id = sqlc.arg(organization_id);
