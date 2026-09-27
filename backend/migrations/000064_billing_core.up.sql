-- Subscription core: feature catalog, plans, plan feature values, per-org
-- subscriptions and periodic usage counters (spec §3). Trial stays a plan.

CREATE TABLE billing_features (
    id          BIGSERIAL    PRIMARY KEY,
    key         VARCHAR(64)  NOT NULL,
    kind        VARCHAR(16)  NOT NULL,            -- limit | toggle | display
    unit        VARCHAR(16)  NOT NULL DEFAULT '', -- adet, GB, ...
    period      VARCHAR(8)   NOT NULL DEFAULT 'none', -- day | month | total | none
    label_tr    VARCHAR(120) NOT NULL,
    label_en    VARCHAR(120) NOT NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_features_key UNIQUE (key),
    CONSTRAINT chk_billing_features_kind CHECK (kind IN ('limit', 'toggle', 'display')),
    CONSTRAINT chk_billing_features_period CHECK (period IN ('day', 'month', 'total', 'none'))
);
CREATE TRIGGER trg_billing_features_set_updated_at BEFORE UPDATE ON billing_features
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_plans (
    id                    BIGSERIAL      PRIMARY KEY,
    uuid                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    code                  VARCHAR(32)    NOT NULL,
    name                  VARCHAR(100)   NOT NULL,
    description           TEXT           NOT NULL DEFAULT '',
    price_monthly         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    yearly_pricing        VARCHAR(16)    NOT NULL DEFAULT 'fixed', -- fixed | discount_amount | discount_percent
    price_yearly          NUMERIC(18, 2) NOT NULL DEFAULT 0,
    yearly_discount_value NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency              CHAR(3)        NOT NULL DEFAULT 'TRY',
    trial_days            INT            NOT NULL DEFAULT 0,
    is_public             BOOLEAN        NOT NULL DEFAULT TRUE,
    is_customizable       BOOLEAN        NOT NULL DEFAULT FALSE,
    badge                 VARCHAR(16)    NOT NULL DEFAULT '',
    sort_order            INT            NOT NULL DEFAULT 0,
    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ    NULL,
    CONSTRAINT uq_billing_plans_uuid UNIQUE (uuid),
    CONSTRAINT chk_billing_plans_yearly CHECK (yearly_pricing IN ('fixed', 'discount_amount', 'discount_percent'))
);
CREATE UNIQUE INDEX uq_billing_plans_code_active ON billing_plans (code) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_billing_plans_set_updated_at BEFORE UPDATE ON billing_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_plan_features (
    id            BIGSERIAL      PRIMARY KEY,
    plan_id       BIGINT         NOT NULL REFERENCES billing_plans (id) ON DELETE CASCADE,
    feature_id    BIGINT         NOT NULL REFERENCES billing_features (id) ON DELETE CASCADE,
    value_int     BIGINT         NULL,
    value_bool    BOOLEAN        NULL,
    display_text  VARCHAR(200)   NOT NULL DEFAULT '',
    enforcement   VARCHAR(8)     NOT NULL DEFAULT 'hard', -- hard | soft
    tolerance_pct INT            NOT NULL DEFAULT 0,
    warn_pct      INT            NOT NULL DEFAULT 80,
    min_value     BIGINT         NULL,
    max_value     BIGINT         NULL,
    step          BIGINT         NULL,
    unit_price    NUMERIC(18, 2) NULL,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_plan_features UNIQUE (plan_id, feature_id),
    CONSTRAINT chk_billing_plan_features_enforcement CHECK (enforcement IN ('hard', 'soft')),
    CONSTRAINT chk_billing_plan_features_pct CHECK (tolerance_pct BETWEEN 0 AND 100 AND warn_pct BETWEEN 0 AND 100)
);
CREATE TRIGGER trg_billing_plan_features_set_updated_at BEFORE UPDATE ON billing_plan_features
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_subscriptions (
    id              BIGSERIAL      PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    plan_id         BIGINT         NOT NULL REFERENCES billing_plans (id),
    period          VARCHAR(8)     NOT NULL DEFAULT 'monthly', -- monthly | yearly
    status          VARCHAR(16)    NOT NULL,                   -- trial | active | grace | read_only | cancelled
    starts_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    ends_at         TIMESTAMPTZ    NOT NULL,
    grace_ends_at   TIMESTAMPTZ    NULL,
    price_paid      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit_balance  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    custom_features JSONB          NOT NULL DEFAULT '{}'::jsonb,
    source          VARCHAR(16)    NOT NULL DEFAULT 'self_service', -- self_service | admin
    note            TEXT           NOT NULL DEFAULT '',
    created_by      BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_subscriptions_uuid UNIQUE (uuid),
    CONSTRAINT chk_billing_subscriptions_period CHECK (period IN ('monthly', 'yearly')),
    CONSTRAINT chk_billing_subscriptions_status CHECK (status IN ('trial', 'active', 'grace', 'read_only', 'cancelled'))
);
-- One live subscription per organization.
CREATE UNIQUE INDEX uq_billing_subscriptions_live
    ON billing_subscriptions (organization_id) WHERE status IN ('trial', 'active', 'grace', 'read_only');
CREATE INDEX idx_billing_subscriptions_ends_at ON billing_subscriptions (ends_at);
CREATE TRIGGER trg_billing_subscriptions_set_updated_at BEFORE UPDATE ON billing_subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_usage_counters (
    organization_id BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    feature_key     VARCHAR(64) NOT NULL,
    period_key      VARCHAR(10) NOT NULL, -- 2026-09-27 | 2026-09 | total
    value           BIGINT      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, feature_key, period_key)
);

-- Permissions (spec §10).
INSERT INTO permissions (name, slug) VALUES
    ('Read platform billing', 'platform.billing.read'),
    ('Write platform billing', 'platform.billing.write'),
    ('Manage platform billing settings', 'platform.billing.settings'),
    ('Read tenant billing', 'tenant.billing.read'),
    ('Write tenant billing', 'tenant.billing.write')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug IN ('platform.billing.read', 'platform.billing.write', 'platform.billing.settings')
WHERE r.slug = 'super_admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug IN ('tenant.billing.read')
WHERE r.slug IN ('organization_owner', 'organization_user', 'super_admin') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug IN ('tenant.billing.write')
WHERE r.slug IN ('organization_owner', 'super_admin') ON CONFLICT DO NOTHING;

-- Builtin feature catalog (spec §4 table). Code upserts the same rows at boot.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('jobs.daily',       'limit',  'adet', 'day',   'Günlük işlem',            'Daily jobs',              10, TRUE),
    ('jobs.monthly',     'limit',  'adet', 'month', 'Aylık işlem',             'Monthly jobs',            20, TRUE),
    ('staff.count',      'limit',  'kişi', 'total', 'Personel sayısı',         'Staff members',           30, TRUE),
    ('customers.count',  'limit',  'adet', 'total', 'Müşteri kaydı',           'Customer records',        40, TRUE),
    ('storage.gb',       'limit',  'GB',   'total', 'Depolama alanı',          'Storage',                 50, TRUE),
    ('whatsapp.enabled', 'toggle', '',     'none',  'WhatsApp mesajlaşma',     'WhatsApp messaging',      60, TRUE),
    ('whatsapp.monthly', 'limit',  'mesaj','month', 'Aylık WhatsApp mesajı',   'Monthly WhatsApp messages',61, TRUE),
    ('ai.enabled',       'toggle', '',     'none',  'Yapay zekâ asistanı',     'AI assistant',            70, TRUE),
    ('ai.monthly',       'limit',  'istek','month', 'Aylık AI isteği',         'Monthly AI requests',     71, TRUE),
    ('module.contracts', 'toggle', '',     'none',  'Sözleşme modülü',         'Contracts module',        80, TRUE),
    ('module.quotes',    'toggle', '',     'none',  'Teklif ve fırsat modülü', 'Quotes & leads module',   90, TRUE),
    ('module.reports',   'toggle', '',     'none',  'Raporlar ve dışa aktarım','Reports & exports',      100, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Trial plan + its limits (spec #13).
INSERT INTO billing_plans (code, name, description, price_monthly, price_yearly, trial_days, is_public, sort_order)
VALUES ('trial', 'Deneme', '14 gün ücretsiz deneme', 0, 0, 14, FALSE, 0);

INSERT INTO billing_plan_features (plan_id, feature_id, value_int, value_bool, enforcement, tolerance_pct)
SELECT p.id, f.id, v.value_int, v.value_bool, 'hard', 0
FROM billing_plans p, (VALUES
    ('jobs.daily',       10::bigint, NULL::boolean),
    ('staff.count',      2,          NULL),
    ('whatsapp.enabled', NULL,       FALSE),
    ('ai.enabled',       NULL,       FALSE),
    ('module.contracts', NULL,       TRUE),
    ('module.quotes',    NULL,       TRUE),
    ('module.reports',   NULL,       TRUE)
) AS v(key, value_int, value_bool)
JOIN billing_features f ON f.key = v.key
WHERE p.code = 'trial';

-- Backfill: every existing organization gets a trial subscription mirroring
-- organizations.access_*. Expired ones stay 'trial' too - F4 owns the
-- grace / read-only transitions; nothing changes for them in F1.
INSERT INTO billing_subscriptions (organization_id, plan_id, period, status, starts_at, ends_at, source, note)
SELECT o.id, p.id, 'monthly', 'trial', o.access_starts_at,
       COALESCE(o.access_ends_at, o.access_starts_at + INTERVAL '14 days'), 'admin', 'backfill 000064'
FROM organizations o, billing_plans p
WHERE p.code = 'trial' AND o.deleted_at IS NULL;
