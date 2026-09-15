CREATE TABLE contract_presets (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    title              VARCHAR(200) NOT NULL,
    description        TEXT         NOT NULL DEFAULT '',
    category           VARCHAR(64)  NOT NULL DEFAULT 'general',
    content_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    content_html       TEXT         NOT NULL DEFAULT '',
    variables          JSONB        NOT NULL DEFAULT '[]'::jsonb,
    signer_slots       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    signature_required BOOLEAN      NOT NULL DEFAULT true,
    is_active          BOOLEAN      NOT NULL DEFAULT true,
    created_by         BIGINT       NULL REFERENCES users (id),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ  NULL,
    CONSTRAINT uq_contract_presets_uuid UNIQUE (uuid)
);

CREATE INDEX idx_contract_presets_active
    ON contract_presets (is_active, title)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_contract_presets_set_updated_at
    BEFORE UPDATE ON contract_presets
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE contract_templates (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    preset_id          BIGINT       NULL REFERENCES contract_presets (id) ON DELETE SET NULL,
    title              VARCHAR(200) NOT NULL,
    description        TEXT         NOT NULL DEFAULT '',
    category           VARCHAR(64)  NOT NULL DEFAULT 'general',
    content_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    content_html       TEXT         NOT NULL DEFAULT '',
    variables          JSONB        NOT NULL DEFAULT '[]'::jsonb,
    signer_slots       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    signature_required BOOLEAN      NOT NULL DEFAULT true,
    is_active          BOOLEAN      NOT NULL DEFAULT true,
    created_by         BIGINT       NOT NULL REFERENCES users (id),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ  NULL,
    CONSTRAINT uq_contract_templates_uuid UNIQUE (uuid)
);

CREATE INDEX idx_contract_templates_org
    ON contract_templates (organization_id, title)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_contract_templates_set_updated_at
    BEFORE UPDATE ON contract_templates
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE contract_instances (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    template_id        BIGINT       NULL REFERENCES contract_templates (id) ON DELETE SET NULL,
    title              VARCHAR(200) NOT NULL,
    subject_type       VARCHAR(32)  NOT NULL,
    subject_uuid       UUID         NOT NULL,
    content_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    content_html       TEXT         NOT NULL DEFAULT '',
    variables_resolved JSONB        NOT NULL DEFAULT '{}'::jsonb,
    signature_required BOOLEAN      NOT NULL DEFAULT true,
    status             VARCHAR(16)  NOT NULL DEFAULT 'draft',
    content_sha256     CHAR(64)     NULL,
    pdf_object_key     TEXT         NULL,
    pdf_error          TEXT         NOT NULL DEFAULT '',
    created_by         BIGINT       NOT NULL REFERENCES users (id),
    executed_at        TIMESTAMPTZ  NULL,
    voided_at          TIMESTAMPTZ  NULL,
    voided_by          BIGINT       NULL REFERENCES users (id),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contract_instances_uuid UNIQUE (uuid),
    CONSTRAINT chk_contract_instances_status CHECK (
        status IN ('draft', 'pending', 'executed', 'voided')
    ),
    CONSTRAINT chk_contract_instances_subject CHECK (
        subject_type IN ('service_job')
    )
);

CREATE INDEX idx_contract_instances_org_status
    ON contract_instances (organization_id, status, created_at DESC);

CREATE INDEX idx_contract_instances_subject
    ON contract_instances (organization_id, subject_type, subject_uuid);

CREATE TRIGGER trg_contract_instances_set_updated_at
    BEFORE UPDATE ON contract_instances
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE contract_signers (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    instance_id        BIGINT       NOT NULL REFERENCES contract_instances (id) ON DELETE CASCADE,
    role               VARCHAR(32)  NOT NULL,
    label              VARCHAR(120) NOT NULL,
    required           BOOLEAN      NOT NULL DEFAULT true,
    sort_order         INT          NOT NULL DEFAULT 0,
    status             VARCHAR(16)  NOT NULL DEFAULT 'pending',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contract_signers_uuid UNIQUE (uuid),
    CONSTRAINT chk_contract_signers_status CHECK (
        status IN ('pending', 'signed')
    )
);

CREATE INDEX idx_contract_signers_instance
    ON contract_signers (instance_id, sort_order);

CREATE TRIGGER trg_contract_signers_set_updated_at
    BEFORE UPDATE ON contract_signers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE contract_signatures (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    instance_id        BIGINT       NOT NULL REFERENCES contract_instances (id) ON DELETE CASCADE,
    signer_id          BIGINT       NOT NULL REFERENCES contract_signers (id) ON DELETE CASCADE,
    display_name       VARCHAR(200) NOT NULL,
    object_key         TEXT         NOT NULL,
    content_sha256     CHAR(64)     NOT NULL,
    signed_by_user_id  BIGINT       NOT NULL REFERENCES users (id),
    ip_address         VARCHAR(64)  NOT NULL DEFAULT '',
    user_agent         TEXT         NOT NULL DEFAULT '',
    signed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contract_signatures_uuid UNIQUE (uuid),
    CONSTRAINT uq_contract_signatures_signer UNIQUE (signer_id)
);

CREATE INDEX idx_contract_signatures_instance
    ON contract_signatures (instance_id);

CREATE TABLE contract_media (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    instance_id        BIGINT       NOT NULL REFERENCES contract_instances (id) ON DELETE CASCADE,
    object_key         TEXT         NOT NULL,
    content_type       VARCHAR(128) NOT NULL DEFAULT 'image/jpeg',
    file_name          VARCHAR(255) NOT NULL DEFAULT '',
    byte_size          BIGINT       NOT NULL DEFAULT 0,
    caption            VARCHAR(255) NOT NULL DEFAULT '',
    sort_order         INT          NOT NULL DEFAULT 0,
    uploaded_by        BIGINT       NOT NULL REFERENCES users (id),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contract_media_uuid UNIQUE (uuid)
);

CREATE INDEX idx_contract_media_instance
    ON contract_media (instance_id, sort_order);

INSERT INTO permissions (name, slug) VALUES
    ('Read contract presets', 'platform.contract_presets.read'),
    ('Write contract presets', 'platform.contract_presets.write'),
    ('Read tenant contracts', 'tenant.contracts.read'),
    ('Write tenant contracts', 'tenant.contracts.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'platform.contract_presets.read',
    'platform.contract_presets.write'
)
WHERE r.slug = 'super_admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.contracts.read')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.contracts.read',
    'tenant.contracts.write'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
