-- Permissions
INSERT INTO permissions (slug, description) VALUES
  ('tenant.messaging.read',  'View messaging settings and session status'),
  ('tenant.messaging.write', 'Manage WhatsApp session and notification settings')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.slug = 'organization_user' AND p.slug = 'tenant.messaging.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.slug = 'organization_owner' AND p.slug IN ('tenant.messaging.read', 'tenant.messaging.write')
ON CONFLICT DO NOTHING;

-- WhatsApp sessions (one per organization)
CREATE TABLE whatsapp_sessions (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status          VARCHAR(32)  NOT NULL DEFAULT 'disconnected',
    jid             VARCHAR(100) NOT NULL DEFAULT '',
    phone_number    VARCHAR(30)  NOT NULL DEFAULT '',
    display_name    VARCHAR(200) NOT NULL DEFAULT '',
    encrypted_keys  BYTEA        NULL,
    last_seen_at    TIMESTAMPTZ  NULL,
    error_message   TEXT         NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_whatsapp_sessions_uuid UNIQUE (uuid),
    CONSTRAINT uq_whatsapp_sessions_org  UNIQUE (organization_id)
);
CREATE TRIGGER trg_whatsapp_sessions_set_updated_at
    BEFORE UPDATE ON whatsapp_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tenant-owned message templates per event+channel+locale
CREATE TABLE message_templates (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type      VARCHAR(64)  NOT NULL,
    channel         VARCHAR(32)  NOT NULL,
    locale          VARCHAR(8)   NOT NULL DEFAULT 'tr',
    subject         VARCHAR(200) NOT NULL DEFAULT '',
    body            TEXT         NOT NULL DEFAULT '',
    variables       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_message_templates_uuid UNIQUE (uuid),
    CONSTRAINT uq_message_templates_org_event_channel_locale
        UNIQUE (organization_id, event_type, channel, locale)
);
CREATE INDEX idx_message_templates_org ON message_templates(organization_id, event_type, channel);
CREATE TRIGGER trg_message_templates_set_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-organization notification rules (which events trigger which channels)
CREATE TABLE notification_rules (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type      VARCHAR(64)  NOT NULL,
    channel         VARCHAR(32)  NOT NULL,
    enabled         BOOLEAN      NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_rules_uuid UNIQUE (uuid),
    CONSTRAINT uq_notification_rules_org_event_channel UNIQUE (organization_id, event_type, channel)
);
CREATE TRIGGER trg_notification_rules_set_updated_at
    BEFORE UPDATE ON notification_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Outbound message log
CREATE TABLE outbound_messages (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id     BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type          VARCHAR(64)  NOT NULL,
    channel             VARCHAR(32)  NOT NULL,
    recipient_phone     VARCHAR(30)  NOT NULL,
    status              VARCHAR(32)  NOT NULL DEFAULT 'queued',
    provider_reference  VARCHAR(200) NOT NULL DEFAULT '',
    error_message       TEXT         NOT NULL DEFAULT '',
    payload             JSONB        NOT NULL DEFAULT '{}'::jsonb,
    subject_type        VARCHAR(64)  NOT NULL DEFAULT '',
    subject_uuid        UUID         NULL,
    sent_at             TIMESTAMPTZ  NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_outbound_messages_uuid UNIQUE (uuid)
);
CREATE INDEX idx_outbound_messages_org ON outbound_messages(organization_id, created_at DESC);
CREATE TRIGGER trg_outbound_messages_set_updated_at
    BEFORE UPDATE ON outbound_messages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
