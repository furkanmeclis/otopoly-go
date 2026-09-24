-- name: GetAISettings :one
SELECT * FROM ai_settings WHERE id = 1;

-- name: UpdateAISettings :one
UPDATE ai_settings
SET provider = COALESCE(sqlc.narg(provider), provider),
    api_key_enc = CASE
        WHEN sqlc.arg(clear_api_key)::boolean THEN NULL
        ELSE COALESCE(sqlc.narg(api_key_enc), api_key_enc)
    END,
    base_url = COALESCE(sqlc.narg(base_url), base_url),
    model = COALESCE(sqlc.narg(model), model),
    title_model = COALESCE(sqlc.narg(title_model), title_model),
    effort = COALESCE(sqlc.narg(effort), effort),
    max_tokens = COALESCE(sqlc.narg(max_tokens), max_tokens),
    chat_enabled = COALESCE(sqlc.narg(chat_enabled), chat_enabled),
    actions_enabled = COALESCE(sqlc.narg(actions_enabled), actions_enabled),
    charts_enabled = COALESCE(sqlc.narg(charts_enabled), charts_enabled),
    voice_enabled = COALESCE(sqlc.narg(voice_enabled), voice_enabled),
    todos_enabled = COALESCE(sqlc.narg(todos_enabled), todos_enabled),
    tool_settings = COALESCE(sqlc.narg(tool_settings), tool_settings),
    extra_instructions = COALESCE(sqlc.narg(extra_instructions), extra_instructions),
    default_monthly_token_quota = COALESCE(sqlc.narg(default_monthly_token_quota), default_monthly_token_quota),
    voice_base_url = COALESCE(sqlc.narg(voice_base_url), voice_base_url),
    voice_stt_model = COALESCE(sqlc.narg(voice_stt_model), voice_stt_model),
    voice_tts_voice = COALESCE(sqlc.narg(voice_tts_voice), voice_tts_voice),
    voice_language = COALESCE(sqlc.narg(voice_language), voice_language),
    updated_by_user_id = sqlc.narg(updated_by_user_id)
WHERE id = 1
RETURNING *;

-- name: GetAIOrganizationSettings :one
SELECT * FROM ai_organization_settings WHERE organization_id = sqlc.arg(organization_id);

-- name: UpsertAIOrganizationSettings :one
INSERT INTO ai_organization_settings (organization_id, enabled, monthly_token_quota)
VALUES (sqlc.arg(organization_id), sqlc.arg(enabled), sqlc.narg(monthly_token_quota))
ON CONFLICT (organization_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    monthly_token_quota = EXCLUDED.monthly_token_quota
RETURNING *;

-- name: SumAIOrganizationTokensSince :one
-- Quota tokens = input + output + cache writes (cache reads are not counted).
SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens), 0)::bigint AS tokens
FROM ai_usage
WHERE organization_id = sqlc.arg(organization_id)
  AND created_at >= sqlc.arg(since);

-- name: InsertAIUsage :exec
INSERT INTO ai_usage (
    organization_id, user_id, conversation_id, provider, model, purpose,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
) VALUES (
    sqlc.narg(organization_id), sqlc.narg(user_id), sqlc.narg(conversation_id),
    sqlc.arg(provider), sqlc.arg(model), sqlc.arg(purpose),
    sqlc.arg(input_tokens), sqlc.arg(output_tokens), sqlc.arg(cache_read_tokens), sqlc.arg(cache_write_tokens)
);

-- name: ListAIUsageByOrganization :many
SELECT
    o.uuid AS organization_uuid,
    o.name AS organization_name,
    o.slug AS organization_slug,
    u.model,
    COALESCE(SUM(u.input_tokens), 0)::bigint AS input_tokens,
    COALESCE(SUM(u.output_tokens), 0)::bigint AS output_tokens,
    COALESCE(SUM(u.cache_read_tokens), 0)::bigint AS cache_read_tokens,
    COALESCE(SUM(u.cache_write_tokens), 0)::bigint AS cache_write_tokens,
    COUNT(*)::bigint AS request_count
FROM ai_usage u
JOIN organizations o ON o.id = u.organization_id
WHERE u.created_at >= sqlc.arg(date_from)
  AND u.created_at < sqlc.arg(date_to)
GROUP BY o.uuid, o.name, o.slug, u.model
ORDER BY o.name ASC, u.model ASC;

-- name: ListAIOrganizationSettingsByOrgIDs :many
SELECT s.*, o.uuid AS organization_uuid
FROM ai_organization_settings s
JOIN organizations o ON o.id = s.organization_id
WHERE o.uuid = ANY (sqlc.arg(organization_uuids)::uuid[]);

-- name: GetAIUserDisplay :one
SELECT uuid, name, surname, email FROM users WHERE id = sqlc.arg(id);

-- name: GetAIOrganizationByUUID :one
SELECT id, uuid, slug, name FROM organizations
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: CreateAIConversation :one
INSERT INTO ai_conversations (organization_id, user_id, title)
VALUES (sqlc.arg(organization_id), sqlc.arg(user_id), sqlc.arg(title))
RETURNING *;

-- name: GetAIConversation :one
SELECT * FROM ai_conversations
WHERE uuid = sqlc.arg(uuid)
  AND organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL;

-- name: ListAIConversations :many
SELECT * FROM ai_conversations
WHERE organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND (sqlc.narg(q)::text IS NULL OR title ILIKE '%' || sqlc.narg(q) || '%')
ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountAIConversations :one
SELECT COUNT(*)::bigint FROM ai_conversations
WHERE organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND (sqlc.narg(q)::text IS NULL OR title ILIKE '%' || sqlc.narg(q) || '%');

-- name: UpdateAIConversationTitle :one
UPDATE ai_conversations
SET title = sqlc.arg(title)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: TouchAIConversation :exec
UPDATE ai_conversations
SET message_count = message_count + sqlc.arg(added)::int,
    last_message_at = now()
WHERE id = sqlc.arg(id);

-- name: SoftDeleteAIConversation :exec
UPDATE ai_conversations
SET deleted_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: InsertAIMessage :one
INSERT INTO ai_messages (
    conversation_id, organization_id, role, status, content, ui, model, input_tokens, output_tokens
) VALUES (
    sqlc.arg(conversation_id), sqlc.arg(organization_id), sqlc.arg(role), sqlc.arg(status),
    sqlc.arg(content), sqlc.arg(ui), sqlc.arg(model), sqlc.arg(input_tokens), sqlc.arg(output_tokens)
)
RETURNING *;

-- name: ListAIMessages :many
SELECT * FROM ai_messages
WHERE conversation_id = sqlc.arg(conversation_id)
ORDER BY id ASC;

-- name: AISearchCustomers :many
-- Turkish-folded search for the assistant: name (diacritics-insensitive),
-- phone digits, or normalized plate.
SELECT
    c.uuid,
    c.name,
    c.phone,
    c.kind,
    c.is_active,
    ca.uuid AS cari_account_uuid,
    ca.balance AS cari_balance,
    ca.currency AS cari_currency,
    COALESCE((
        SELECT string_agg(v.plate, ', ' ORDER BY v.plate)
        FROM customer_vehicles v
        WHERE v.customer_id = c.id AND v.deleted_at IS NULL
    ), '')::text AS plates
FROM customers c
LEFT JOIN cari_accounts ca ON ca.customer_id = c.id AND ca.deleted_at IS NULL
WHERE c.organization_id = sqlc.arg(organization_id)
  AND c.deleted_at IS NULL
  AND (
    translate(lower(translate(c.name, 'İI', 'ii')), 'çğıöşüâîû', 'cgiosuaiu') LIKE '%' || sqlc.arg(folded)::text || '%'
    OR (sqlc.arg(digits)::text <> '' AND regexp_replace(c.phone, '\D', '', 'g') LIKE '%' || sqlc.arg(digits)::text || '%')
    OR (sqlc.arg(plate)::text <> '' AND EXISTS (
        SELECT 1 FROM customer_vehicles v
        WHERE v.customer_id = c.id AND v.deleted_at IS NULL
          AND regexp_replace(upper(v.plate), '[^A-Z0-9]', '', 'g') LIKE '%' || sqlc.arg(plate)::text || '%'
    ))
  )
ORDER BY c.is_active DESC, c.name ASC
LIMIT sqlc.arg(limit_count);

-- name: GetAIMessageByID :one
SELECT * FROM ai_messages WHERE id = sqlc.arg(id);

-- name: UpdateAIMessageContentUI :exec
UPDATE ai_messages
SET content = sqlc.arg(content), ui = sqlc.arg(ui)
WHERE id = sqlc.arg(id);

-- name: InsertAIPendingAction :one
INSERT INTO ai_pending_actions (
    organization_id, user_id, conversation_id, tool_use_id, tool_name,
    input, preview, idempotency_key, expires_at
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(user_id), sqlc.arg(conversation_id), sqlc.arg(tool_use_id),
    sqlc.arg(tool_name), sqlc.arg(input), sqlc.arg(preview), sqlc.arg(idempotency_key), sqlc.arg(expires_at)
)
RETURNING *;

-- name: GetAIPendingActionForUser :one
SELECT a.*, c.uuid AS conversation_uuid
FROM ai_pending_actions a
JOIN ai_conversations c ON c.id = a.conversation_id AND c.deleted_at IS NULL
WHERE a.uuid = sqlc.arg(uuid)
  AND a.organization_id = sqlc.arg(organization_id)
  AND a.user_id = sqlc.arg(user_id);

-- name: AttachAIPendingActionsToMessage :exec
UPDATE ai_pending_actions
SET message_id = sqlc.arg(message_id)
WHERE conversation_id = sqlc.arg(conversation_id)
  AND message_id IS NULL;

-- name: ClaimAIPendingAction :one
-- The pending → executing transition is the idempotency lock for confirm.
UPDATE ai_pending_actions
SET status = 'executing',
    input = sqlc.arg(input),
    preview = sqlc.arg(preview)
WHERE id = sqlc.arg(id)
  AND status = 'pending'
  AND message_id IS NOT NULL
  AND expires_at > now()
RETURNING *;

-- name: FinishAIPendingAction :one
UPDATE ai_pending_actions
SET status = sqlc.arg(status),
    result = sqlc.narg(result),
    error = sqlc.arg(error),
    resolved_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CancelAIPendingAction :one
UPDATE ai_pending_actions
SET status = 'cancelled', resolved_at = now()
WHERE id = sqlc.arg(id) AND status = 'pending'
RETURNING *;

-- name: ExpireAIPendingActions :many
-- Expires pending actions of a conversation: all of them (the user moved on)
-- or only those past expires_at.
UPDATE ai_pending_actions
SET status = 'expired', resolved_at = now()
WHERE conversation_id = sqlc.arg(conversation_id)
  AND status = 'pending'
  AND (sqlc.arg(all_pending)::boolean OR expires_at <= now())
RETURNING *;
