-- WhatsApp platform sender (Cloud API or platform whatsmeow number).
-- Spec: docs/superpowers/specs/2026-10-07-whatsapp-cloud-api-design.md "Data model".

-- Singleton platform sender settings. Secrets are SecretBox ciphertext.
CREATE TABLE platform_whatsapp_settings (
    id                        SMALLINT     PRIMARY KEY DEFAULT 1,
    provider                  TEXT         NOT NULL DEFAULT 'none',
    app_id                    TEXT         NOT NULL DEFAULT '',
    waba_id                   TEXT         NOT NULL DEFAULT '',
    phone_number_id           TEXT         NOT NULL DEFAULT '',
    api_version               TEXT         NOT NULL DEFAULT 'v26.0',
    access_token_enc          BYTEA        NULL,
    app_secret_enc            BYTEA        NULL,
    webhook_verify_token_enc  BYTEA        NULL,
    display_phone             TEXT         NOT NULL DEFAULT '',
    wm_status                 TEXT         NOT NULL DEFAULT 'disconnected',
    wm_jid                    TEXT         NOT NULL DEFAULT '',
    wm_phone                  TEXT         NOT NULL DEFAULT '',
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by                BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT platform_whatsapp_settings_singleton CHECK (id = 1),
    CONSTRAINT chk_platform_whatsapp_settings_provider CHECK (provider IN ('none', 'whatsmeow', 'cloud'))
);

INSERT INTO platform_whatsapp_settings (id) VALUES (1);

CREATE TRIGGER trg_platform_whatsapp_settings_set_updated_at
    BEFORE UPDATE ON platform_whatsapp_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Meta template state per platform catalog entry.
CREATE TABLE whatsapp_cloud_templates (
    id                BIGSERIAL    PRIMARY KEY,
    key               VARCHAR(64)  NOT NULL,
    meta_name         VARCHAR(512) NOT NULL,
    override_name     VARCHAR(512) NULL,
    language          VARCHAR(16)  NOT NULL DEFAULT 'tr',
    category          VARCHAR(32)  NOT NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'not_submitted',
    meta_template_id  TEXT         NOT NULL DEFAULT '',
    rejected_reason   TEXT         NOT NULL DEFAULT '',
    last_synced_at    TIMESTAMPTZ  NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_whatsapp_cloud_templates_key UNIQUE (key),
    CONSTRAINT chk_whatsapp_cloud_templates_category CHECK (category IN ('UTILITY', 'AUTHENTICATION', 'MARKETING')),
    CONSTRAINT chk_whatsapp_cloud_templates_status CHECK (
        status IN ('not_submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled'))
);

CREATE TRIGGER trg_whatsapp_cloud_templates_set_updated_at
    BEFORE UPDATE ON whatsapp_cloud_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Org own session: fall back to the platform number while disconnected.
ALTER TABLE whatsapp_sessions
    ADD COLUMN fallback_to_platform BOOLEAN NOT NULL DEFAULT TRUE;

-- Outbound log: sender + Cloud delivery tracking.
ALTER TABLE outbound_messages
    ADD COLUMN sender_kind        TEXT        NULL,
    ADD COLUMN template_name      TEXT        NULL,
    ADD COLUMN delivery_status    TEXT        NULL,
    ADD COLUMN delivery_status_at TIMESTAMPTZ NULL,
    ADD COLUMN pricing_category   TEXT        NULL,
    ADD COLUMN billable           BOOLEAN     NULL,
    ADD COLUMN error_code         TEXT        NULL;

CREATE INDEX idx_outbound_messages_provider_reference
    ON outbound_messages (provider_reference);

-- Plan feature: business may send from its own number. Code upserts it at boot too.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('whatsapp.own_number', 'toggle', '', 'none', 'Kendi WhatsApp numarası', 'Own WhatsApp number', 62, TRUE)
ON CONFLICT (key) DO NOTHING;

INSERT INTO billing_plan_features (plan_id, feature_id, value_int, value_bool, enforcement, tolerance_pct)
SELECT p.id, f.id, NULL, FALSE, 'hard', 0
FROM billing_plans p
JOIN billing_features f ON f.key = 'whatsapp.own_number'
WHERE p.code = 'trial' AND p.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- Permissions.
INSERT INTO permissions (name, slug) VALUES
    ('Read platform WhatsApp integration', 'platform.integrations.whatsapp.read'),
    ('Write platform WhatsApp integration', 'platform.integrations.whatsapp.write')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug IN ('platform.integrations.whatsapp.read', 'platform.integrations.whatsapp.write')
WHERE r.slug = 'super_admin' ON CONFLICT DO NOTHING;
