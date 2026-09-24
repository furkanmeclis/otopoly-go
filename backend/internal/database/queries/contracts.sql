-- name: ListContractPresets :many
SELECT *
FROM contract_presets
WHERE deleted_at IS NULL
  AND (
    sqlc.narg('q')::text IS NULL
    OR title ILIKE '%' || sqlc.narg('q')::text || '%'
    OR description ILIKE '%' || sqlc.narg('q')::text || '%'
  )
  AND (
    sqlc.narg('is_active')::boolean IS NULL
    OR is_active = sqlc.narg('is_active')::boolean
  )
ORDER BY
  CASE WHEN sqlc.arg('sort') = 'title' THEN title END ASC,
  CASE WHEN sqlc.arg('sort') = '-title' THEN title END DESC,
  CASE WHEN sqlc.arg('sort') = 'created_at' THEN created_at END ASC,
  CASE WHEN sqlc.arg('sort') = '-created_at' THEN created_at END DESC,
  created_at DESC
LIMIT sqlc.arg('limit_count') OFFSET sqlc.arg('offset_count');

-- name: CountContractPresets :one
SELECT count(*)::bigint
FROM contract_presets
WHERE deleted_at IS NULL
  AND (
    sqlc.narg('q')::text IS NULL
    OR title ILIKE '%' || sqlc.narg('q')::text || '%'
    OR description ILIKE '%' || sqlc.narg('q')::text || '%'
  )
  AND (
    sqlc.narg('is_active')::boolean IS NULL
    OR is_active = sqlc.narg('is_active')::boolean
  );

-- name: GetContractPresetByUUID :one
SELECT *
FROM contract_presets
WHERE uuid = $1 AND deleted_at IS NULL;

-- name: CreateContractPreset :one
INSERT INTO contract_presets (
    title, description, category, content_json, content_html,
    variables, signer_slots, signature_required, is_active, created_by,
    otp_required
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING *;

-- name: UpdateContractPreset :one
UPDATE contract_presets
SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    category = COALESCE(sqlc.narg('category'), category),
    content_json = COALESCE(sqlc.narg('content_json'), content_json),
    content_html = COALESCE(sqlc.narg('content_html'), content_html),
    variables = COALESCE(sqlc.narg('variables'), variables),
    signer_slots = COALESCE(sqlc.narg('signer_slots'), signer_slots),
    signature_required = COALESCE(sqlc.narg('signature_required'), signature_required),
    otp_required = COALESCE(sqlc.narg('otp_required'), otp_required),
    is_active = COALESCE(sqlc.narg('is_active'), is_active)
WHERE uuid = sqlc.arg('uuid') AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteContractPreset :exec
UPDATE contract_presets
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND deleted_at IS NULL;

-- name: ListContractTemplates :many
SELECT *
FROM contract_templates
WHERE organization_id = $1
  AND deleted_at IS NULL
  AND (
    sqlc.narg('q')::text IS NULL
    OR title ILIKE '%' || sqlc.narg('q')::text || '%'
  )
  AND (
    sqlc.narg('is_active')::boolean IS NULL
    OR is_active = sqlc.narg('is_active')::boolean
  )
ORDER BY
  CASE WHEN sqlc.arg('sort') = 'title' THEN title END ASC,
  CASE WHEN sqlc.arg('sort') = '-title' THEN title END DESC,
  CASE WHEN sqlc.arg('sort') = 'created_at' THEN created_at END ASC,
  CASE WHEN sqlc.arg('sort') = '-created_at' THEN created_at END DESC,
  created_at DESC
LIMIT sqlc.arg('limit_count') OFFSET sqlc.arg('offset_count');

-- name: CountContractTemplates :one
SELECT count(*)::bigint
FROM contract_templates
WHERE organization_id = $1
  AND deleted_at IS NULL
  AND (
    sqlc.narg('q')::text IS NULL
    OR title ILIKE '%' || sqlc.narg('q')::text || '%'
  )
  AND (
    sqlc.narg('is_active')::boolean IS NULL
    OR is_active = sqlc.narg('is_active')::boolean
  );

-- name: GetContractTemplateByUUID :one
SELECT *
FROM contract_templates
WHERE uuid = $1
  AND organization_id = $2
  AND deleted_at IS NULL;

-- name: CreateContractTemplate :one
INSERT INTO contract_templates (
    organization_id, preset_id, title, description, category,
    content_json, content_html, variables, signer_slots,
    signature_required, is_active, created_by, otp_required
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING *;

-- name: UpdateContractTemplate :one
UPDATE contract_templates
SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    category = COALESCE(sqlc.narg('category'), category),
    content_json = COALESCE(sqlc.narg('content_json'), content_json),
    content_html = COALESCE(sqlc.narg('content_html'), content_html),
    variables = COALESCE(sqlc.narg('variables'), variables),
    signer_slots = COALESCE(sqlc.narg('signer_slots'), signer_slots),
    signature_required = COALESCE(sqlc.narg('signature_required'), signature_required),
    otp_required = COALESCE(sqlc.narg('otp_required'), otp_required),
    is_active = COALESCE(sqlc.narg('is_active'), is_active)
WHERE uuid = sqlc.arg('uuid')
  AND organization_id = sqlc.arg('organization_id')
  AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteContractTemplate :exec
UPDATE contract_templates
SET deleted_at = NOW(), is_active = false
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: ListContractInstances :many
SELECT *
FROM contract_instances
WHERE organization_id = $1
  AND (
    sqlc.narg('status')::text IS NULL
    OR status = sqlc.narg('status')::text
  )
  AND (
    sqlc.narg('subject_type')::text IS NULL
    OR subject_type = sqlc.narg('subject_type')::text
  )
  AND (
    sqlc.narg('subject_uuid')::uuid IS NULL
    OR subject_uuid = sqlc.narg('subject_uuid')::uuid
  )
  AND (
    sqlc.narg('q')::text IS NULL
    OR title ILIKE '%' || sqlc.narg('q')::text || '%'
  )
ORDER BY created_at DESC
LIMIT sqlc.arg('limit_count') OFFSET sqlc.arg('offset_count');

-- name: CountContractInstances :one
SELECT count(*)::bigint
FROM contract_instances
WHERE organization_id = $1
  AND (
    sqlc.narg('status')::text IS NULL
    OR status = sqlc.narg('status')::text
  )
  AND (
    sqlc.narg('subject_type')::text IS NULL
    OR subject_type = sqlc.narg('subject_type')::text
  )
  AND (
    sqlc.narg('subject_uuid')::uuid IS NULL
    OR subject_uuid = sqlc.narg('subject_uuid')::uuid
  )
  AND (
    sqlc.narg('q')::text IS NULL
    OR title ILIKE '%' || sqlc.narg('q')::text || '%'
  );

-- name: GetContractInstanceByUUID :one
SELECT *
FROM contract_instances
WHERE uuid = $1 AND organization_id = $2;

-- name: GetContractInstanceByID :one
SELECT *
FROM contract_instances
WHERE id = $1;

-- name: NextContractInstanceNumber :one
SELECT COALESCE(MAX(number), 0)::int + 1
FROM contract_instances
WHERE organization_id = $1;

-- name: CreateContractInstance :one
INSERT INTO contract_instances (
    organization_id, template_id, title, subject_type, subject_uuid,
    content_json, content_html, variables_resolved, signature_required,
    status, created_by, number, locale, otp_required
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
RETURNING *;

-- name: UpdateContractInstanceStatus :one
UPDATE contract_instances
SET
    status = $3,
    content_sha256 = COALESCE(sqlc.narg('content_sha256'), content_sha256),
    pdf_object_key = COALESCE(sqlc.narg('pdf_object_key'), pdf_object_key),
    pdf_error = COALESCE(sqlc.narg('pdf_error'), pdf_error),
    executed_at = COALESCE(sqlc.narg('executed_at'), executed_at),
    voided_at = COALESCE(sqlc.narg('voided_at'), voided_at),
    voided_by = COALESCE(sqlc.narg('voided_by'), voided_by)
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: SetContractInstancePDFError :exec
UPDATE contract_instances
SET pdf_error = $2
WHERE id = $1;

-- name: CreateContractSigner :one
INSERT INTO contract_signers (
    organization_id, instance_id, role, label, required, sort_order, status,
    suggested_name, phone
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: ListContractSignersByInstance :many
SELECT *
FROM contract_signers
WHERE instance_id = $1
ORDER BY sort_order ASC, id ASC;

-- name: GetContractSignerByUUID :one
SELECT *
FROM contract_signers
WHERE uuid = $1
  AND organization_id = $2
  AND instance_id = $3;

-- name: MarkContractSignerSigned :one
UPDATE contract_signers
SET status = 'signed'
WHERE id = $1
RETURNING *;

-- name: MarkContractSignerOTPVerified :one
UPDATE contract_signers
SET otp_verified_at = $2,
    otp_channel = $3,
    otp_phone = $4
WHERE id = $1
RETURNING *;

-- name: UpdateContractSignerPhone :exec
UPDATE contract_signers
SET phone = $2
WHERE id = $1;

-- name: CreateContractSignerOTP :one
INSERT INTO contract_signer_otps (
    organization_id, instance_id, signer_id, channel, phone, code_hash,
    message_sha256, provider_reference, max_attempts, expires_at,
    sent_by_user_id, ip_address, user_agent
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING *;

-- name: GetLatestContractSignerOTP :one
SELECT *
FROM contract_signer_otps
WHERE signer_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: CountContractSignerOTPsSince :one
SELECT count(*)::bigint
FROM contract_signer_otps
WHERE signer_id = $1
  AND created_at >= $2;

-- name: IncrementContractSignerOTPAttempts :one
UPDATE contract_signer_otps
SET attempts = attempts + 1
WHERE id = $1
RETURNING *;

-- name: MarkContractSignerOTPVerifiedAt :exec
UPDATE contract_signer_otps
SET verified_at = $2
WHERE id = $1;

-- name: CountPendingRequiredSigners :one
SELECT count(*)::bigint
FROM contract_signers
WHERE instance_id = $1
  AND required = true
  AND status = 'pending';

-- name: CreateContractSignature :one
INSERT INTO contract_signatures (
    organization_id, instance_id, signer_id, display_name, object_key,
    content_sha256, signed_by_user_id, ip_address, user_agent
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: ListContractSignaturesByInstance :many
SELECT *
FROM contract_signatures
WHERE instance_id = $1
ORDER BY signed_at ASC;

-- name: CreateContractMedia :one
INSERT INTO contract_media (
    organization_id, instance_id, object_key, content_type, file_name,
    byte_size, caption, sort_order, uploaded_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: ListContractMediaByInstance :many
SELECT *
FROM contract_media
WHERE instance_id = $1
ORDER BY sort_order ASC, id ASC;

-- name: GetContractMediaByUUID :one
SELECT *
FROM contract_media
WHERE uuid = $1 AND organization_id = $2 AND instance_id = $3;

-- name: DeleteContractMedia :exec
DELETE FROM contract_media
WHERE uuid = $1 AND organization_id = $2 AND instance_id = $3;
