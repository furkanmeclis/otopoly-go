CREATE TABLE cari_accounts (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    customer_id     BIGINT         NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    balance         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN        NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ    NULL,
    CONSTRAINT uq_cari_accounts_uuid UNIQUE (uuid),
    CONSTRAINT uq_cari_accounts_customer UNIQUE (customer_id)
);

CREATE INDEX idx_cari_accounts_org
    ON cari_accounts (organization_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_cari_accounts_org_balance
    ON cari_accounts (organization_id, balance DESC)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_cari_accounts_set_updated_at
    BEFORE UPDATE ON cari_accounts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE cari_entries (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    account_id             BIGINT         NOT NULL REFERENCES cari_accounts (id),
    type                   VARCHAR(16)    NOT NULL,
    status                 VARCHAR(16)    NOT NULL DEFAULT 'posted',
    amount                 NUMERIC(18, 2) NOT NULL,
    balance_after          NUMERIC(18, 2) NOT NULL,
    entry_date             DATE           NOT NULL,
    description            TEXT           NOT NULL DEFAULT '',
    reference_no           VARCHAR(64)    NULL,
    payment_method         VARCHAR(32)    NULL,
    finance_account_id     BIGINT         NULL REFERENCES finance_accounts (id),
    finance_transaction_id BIGINT         NULL REFERENCES finance_transactions (id),
    created_by             BIGINT         NOT NULL REFERENCES users (id),
    voided_at              TIMESTAMPTZ    NULL,
    voided_by              BIGINT         NULL REFERENCES users (id),
    source_type            VARCHAR(32)    NULL,
    source_uuid            UUID           NULL,
    metadata               JSONB          NOT NULL DEFAULT '{}',
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cari_entries_uuid UNIQUE (uuid),
    CONSTRAINT chk_cari_entries_type CHECK (type IN ('charge', 'payment', 'adjustment', 'opening')),
    CONSTRAINT chk_cari_entries_status CHECK (status IN ('posted', 'void')),
    CONSTRAINT chk_cari_entries_amount CHECK (amount > 0),
    CONSTRAINT chk_cari_entries_payment_method CHECK (
        payment_method IS NULL OR payment_method IN ('cash', 'card', 'transfer', 'other')
    )
);

CREATE INDEX idx_cari_entries_org_date
    ON cari_entries (organization_id, entry_date DESC);

CREATE INDEX idx_cari_entries_account_date
    ON cari_entries (account_id, entry_date DESC, created_at DESC);

CREATE INDEX idx_cari_entries_source
    ON cari_entries (source_type, source_uuid)
    WHERE source_type IS NOT NULL;

CREATE TRIGGER trg_cari_entries_set_updated_at
    BEFORE UPDATE ON cari_entries
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Backfill one cari account per existing customer.
INSERT INTO cari_accounts (organization_id, customer_id, currency, balance, is_active)
SELECT c.organization_id, c.id, 'TRY', 0, c.is_active
FROM customers c
WHERE c.deleted_at IS NULL
ON CONFLICT (customer_id) DO NOTHING;

-- Seed "Cari Tahsilat" income category for orgs that already have finance categories.
INSERT INTO finance_categories (organization_id, name, kind, sort_order, is_active)
SELECT DISTINCT fc.organization_id, 'Cari Tahsilat', 'income', 3, true
FROM finance_categories fc
WHERE fc.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM finance_categories x
      WHERE x.organization_id = fc.organization_id
        AND x.deleted_at IS NULL
        AND lower(x.name) = lower('Cari Tahsilat')
  );

INSERT INTO permissions (name, slug) VALUES
    ('Read tenant cari', 'tenant.cari.read'),
    ('Write tenant cari', 'tenant.cari.write'),
    ('Export tenant cari', 'tenant.cari.export')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.cari.read', 'tenant.cari.export')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.cari.read',
    'tenant.cari.write',
    'tenant.cari.export'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
