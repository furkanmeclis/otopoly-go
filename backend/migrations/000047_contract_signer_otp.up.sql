-- Contract signing: auto-filled signer names + WhatsApp OTP consent verification.

ALTER TABLE contract_presets
    ADD COLUMN IF NOT EXISTS otp_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE contract_templates
    ADD COLUMN IF NOT EXISTS otp_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE contract_instances
    ADD COLUMN IF NOT EXISTS otp_required BOOLEAN NOT NULL DEFAULT false;

-- suggested_name / phone are resolved at instance create (customer → job customer,
-- staff → job assignee or creator). otp_* capture the verified consent evidence.
ALTER TABLE contract_signers
    ADD COLUMN IF NOT EXISTS suggested_name VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS otp_channel VARCHAR(16) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS otp_phone VARCHAR(32) NOT NULL DEFAULT '';

CREATE TABLE contract_signer_otps (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    instance_id        BIGINT       NOT NULL REFERENCES contract_instances (id) ON DELETE CASCADE,
    signer_id          BIGINT       NOT NULL REFERENCES contract_signers (id) ON DELETE CASCADE,
    channel            VARCHAR(16)  NOT NULL DEFAULT 'whatsapp',
    phone              VARCHAR(32)  NOT NULL,
    code_hash          CHAR(64)     NOT NULL,
    message_sha256     CHAR(64)     NOT NULL DEFAULT '',
    provider_reference TEXT         NOT NULL DEFAULT '',
    attempts           INT          NOT NULL DEFAULT 0,
    max_attempts       INT          NOT NULL DEFAULT 5,
    expires_at         TIMESTAMPTZ  NOT NULL,
    verified_at        TIMESTAMPTZ  NULL,
    sent_by_user_id    BIGINT       NOT NULL REFERENCES users (id),
    ip_address         VARCHAR(64)  NOT NULL DEFAULT '',
    user_agent         TEXT         NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contract_signer_otps_uuid UNIQUE (uuid)
);

CREATE INDEX idx_contract_signer_otps_signer
    ON contract_signer_otps (signer_id, created_at DESC);
