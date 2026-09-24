-- AI assistant (phase 1): platform settings, per-organization overrides,
-- conversations, messages, usage ledger, and permissions.

-- Platform singleton settings (like github_app_settings).
CREATE TABLE ai_settings (
    id                          SMALLINT     PRIMARY KEY DEFAULT 1,
    provider                    VARCHAR(32)  NOT NULL DEFAULT 'anthropic',
    api_key_enc                 TEXT,
    base_url                    TEXT         NOT NULL DEFAULT '',
    model                       VARCHAR(128) NOT NULL DEFAULT 'claude-opus-5',
    title_model                 VARCHAR(128) NOT NULL DEFAULT 'claude-haiku-4-5',
    effort                      VARCHAR(16)  NOT NULL DEFAULT 'medium',
    max_tokens                  INTEGER      NOT NULL DEFAULT 16000,
    chat_enabled                BOOLEAN      NOT NULL DEFAULT FALSE,
    actions_enabled             BOOLEAN      NOT NULL DEFAULT FALSE,
    charts_enabled              BOOLEAN      NOT NULL DEFAULT TRUE,
    voice_enabled               BOOLEAN      NOT NULL DEFAULT FALSE,
    todos_enabled               BOOLEAN      NOT NULL DEFAULT FALSE,
    -- {"tool_name": false} disables a tool; missing keys mean enabled.
    tool_settings               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    extra_instructions          TEXT         NOT NULL DEFAULT '',
    -- 0 = unlimited.
    default_monthly_token_quota BIGINT       NOT NULL DEFAULT 2000000,
    voice_base_url              TEXT         NOT NULL DEFAULT '',
    voice_stt_model             VARCHAR(128) NOT NULL DEFAULT '',
    voice_tts_voice             VARCHAR(128) NOT NULL DEFAULT '',
    voice_language              VARCHAR(16)  NOT NULL DEFAULT 'tr',
    updated_by_user_id          BIGINT       REFERENCES users (id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ai_settings_singleton CHECK (id = 1),
    CONSTRAINT chk_ai_settings_provider CHECK (provider IN ('anthropic', 'openai_compatible')),
    CONSTRAINT chk_ai_settings_effort CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
    CONSTRAINT chk_ai_settings_max_tokens CHECK (max_tokens BETWEEN 256 AND 128000),
    CONSTRAINT chk_ai_settings_quota CHECK (default_monthly_token_quota >= 0)
);

CREATE TRIGGER trg_ai_settings_updated_at
    BEFORE UPDATE ON ai_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO ai_settings (id) VALUES (1);

-- Per-organization override. No row = enabled with the platform default quota.
CREATE TABLE ai_organization_settings (
    organization_id     BIGINT      PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
    enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
    -- NULL = inherit platform default; 0 = unlimited.
    monthly_token_quota BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ai_org_settings_quota CHECK (monthly_token_quota IS NULL OR monthly_token_quota >= 0)
);

CREATE TRIGGER trg_ai_organization_settings_updated_at
    BEFORE UPDATE ON ai_organization_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ai_conversations (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL DEFAULT '',
    message_count   INTEGER      NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_ai_conversations_uuid UNIQUE (uuid)
);

CREATE INDEX idx_ai_conversations_org_user
    ON ai_conversations (organization_id, user_id, COALESCE(last_message_at, created_at) DESC)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_ai_conversations_updated_at
    BEFORE UPDATE ON ai_conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per user input and one row per assistant turn.
-- content: provider-neutral API messages (Anthropic block shape) replayed to the
--          model: [{"role": "...", "content": [blocks]}]. An assistant turn row
--          holds the whole tool loop (assistant tool_use → user tool_result → ...).
-- ui:      render blocks for the chat UI (text, tool activity, chart, ...).
CREATE TABLE ai_messages (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    conversation_id BIGINT       NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    role            VARCHAR(16)  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'complete',
    content         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    ui              JSONB        NOT NULL DEFAULT '[]'::jsonb,
    model           VARCHAR(128) NOT NULL DEFAULT '',
    input_tokens    BIGINT       NOT NULL DEFAULT 0,
    output_tokens   BIGINT       NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_ai_messages_uuid UNIQUE (uuid),
    CONSTRAINT chk_ai_messages_role CHECK (role IN ('user', 'assistant')),
    CONSTRAINT chk_ai_messages_status CHECK (status IN ('complete', 'error', 'cancelled', 'pending'))
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages (conversation_id, id);

-- Usage ledger: one row per model call.
CREATE TABLE ai_usage (
    id                 BIGSERIAL    PRIMARY KEY,
    organization_id    BIGINT       REFERENCES organizations (id) ON DELETE CASCADE,
    user_id            BIGINT       REFERENCES users (id) ON DELETE SET NULL,
    conversation_id    BIGINT       REFERENCES ai_conversations (id) ON DELETE SET NULL,
    provider           VARCHAR(32)  NOT NULL,
    model              VARCHAR(128) NOT NULL,
    purpose            VARCHAR(16)  NOT NULL DEFAULT 'chat',
    input_tokens       BIGINT       NOT NULL DEFAULT 0,
    output_tokens      BIGINT       NOT NULL DEFAULT 0,
    cache_read_tokens  BIGINT       NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT       NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_ai_usage_purpose CHECK (purpose IN ('chat', 'title', 'test'))
);

CREATE INDEX idx_ai_usage_org_created ON ai_usage (organization_id, created_at);
CREATE INDEX idx_ai_usage_created ON ai_usage (created_at);

-- Permissions.
INSERT INTO permissions (name, slug) VALUES
    ('Read AI assistant settings', 'platform.ai.read'),
    ('Write AI assistant settings', 'platform.ai.write'),
    ('Use AI assistant', 'tenant.ai.use')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('platform.ai.read', 'platform.ai.write', 'tenant.ai.use')
WHERE r.slug = 'super_admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.ai.use'
WHERE r.slug = 'organization_owner'
ON CONFLICT DO NOTHING;
