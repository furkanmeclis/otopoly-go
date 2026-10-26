-- Per-organization SMS provider accounts (Netgsm, Twilio). Credentials are
-- sealed by the API (platform/crypto SecretBox, APP encryption key) and only
-- masked hints leave the backend. At most one account per organization is
-- the active SMS channel.
CREATE TABLE sms_provider_accounts (
    id               BIGSERIAL    PRIMARY KEY,
    uuid             UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id  BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    provider         VARCHAR(24)  NOT NULL,
    -- Netgsm message header / Twilio From number or Messaging Service SID.
    sender           VARCHAR(64)  NOT NULL DEFAULT '',
    credentials_enc  TEXT         NOT NULL,
    credential_hints JSONB        NOT NULL DEFAULT '{}'::jsonb,
    is_active        BOOLEAN      NOT NULL DEFAULT FALSE,
    status           VARCHAR(16)  NOT NULL DEFAULT 'unchecked',
    last_checked_at  TIMESTAMPTZ  NULL,
    last_error       TEXT         NOT NULL DEFAULT '',
    created_by       BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    updated_by       BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sms_provider_accounts_uuid UNIQUE (uuid),
    CONSTRAINT uq_sms_provider_accounts_org_provider UNIQUE (organization_id, provider),
    CONSTRAINT chk_sms_provider_accounts_provider CHECK (provider IN ('netgsm', 'twilio')),
    CONSTRAINT chk_sms_provider_accounts_status CHECK (status IN ('unchecked', 'connected', 'error'))
);

-- One active SMS provider per organization.
CREATE UNIQUE INDEX uq_sms_provider_accounts_org_active
    ON sms_provider_accounts (organization_id)
    WHERE is_active;

CREATE TRIGGER trg_sms_provider_accounts_set_updated_at
    BEFORE UPDATE ON sms_provider_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
