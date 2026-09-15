CREATE TABLE suppliers (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    phone           VARCHAR(32)  NOT NULL DEFAULT '',
    email           VARCHAR(255) NOT NULL DEFAULT '',
    tax_id          VARCHAR(64)  NOT NULL DEFAULT '',
    notes           TEXT         NOT NULL DEFAULT '',
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_suppliers_uuid UNIQUE (uuid)
);

CREATE INDEX idx_suppliers_org
    ON suppliers (organization_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_suppliers_org_name
    ON suppliers (organization_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_suppliers_set_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchases (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    supplier_id            BIGINT         NOT NULL REFERENCES suppliers (id),
    supplier_name          VARCHAR(150)   NOT NULL DEFAULT '',
    status                 VARCHAR(16)    NOT NULL DEFAULT 'posted',
    currency               CHAR(3)        NOT NULL DEFAULT 'TRY',
    total_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    method                 VARCHAR(16)    NOT NULL,
    finance_account_id     BIGINT         NULL REFERENCES finance_accounts (id),
    finance_transaction_id BIGINT         NULL REFERENCES finance_transactions (id),
    notes                  TEXT           NOT NULL DEFAULT '',
    purchased_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by             BIGINT         NOT NULL REFERENCES users (id),
    voided_at              TIMESTAMPTZ    NULL,
    voided_by              BIGINT         NULL REFERENCES users (id),
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_purchases_uuid UNIQUE (uuid),
    CONSTRAINT chk_purchases_status CHECK (status IN ('posted', 'voided')),
    CONSTRAINT chk_purchases_method CHECK (method IN ('cash', 'card')),
    CONSTRAINT chk_purchases_total CHECK (total_amount > 0)
);

CREATE INDEX idx_purchases_org_purchased
    ON purchases (organization_id, purchased_at DESC);

CREATE INDEX idx_purchases_org_status
    ON purchases (organization_id, status, purchased_at DESC);

CREATE INDEX idx_purchases_supplier
    ON purchases (supplier_id, purchased_at DESC);

CREATE TRIGGER trg_purchases_set_updated_at
    BEFORE UPDATE ON purchases
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_lines (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    purchase_id     BIGINT         NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
    product_id      BIGINT         NOT NULL REFERENCES products (id),
    name            VARCHAR(200)   NOT NULL,
    unit_cost       NUMERIC(18, 2) NOT NULL,
    qty             NUMERIC(18, 3) NOT NULL DEFAULT 1,
    line_total      NUMERIC(18, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    sort_order      INT            NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_purchase_lines_uuid UNIQUE (uuid),
    CONSTRAINT chk_purchase_lines_qty CHECK (qty > 0),
    CONSTRAINT chk_purchase_lines_cost CHECK (unit_cost >= 0),
    CONSTRAINT chk_purchase_lines_total CHECK (line_total >= 0)
);

CREATE INDEX idx_purchase_lines_purchase
    ON purchase_lines (purchase_id, sort_order);

CREATE TRIGGER trg_purchase_lines_set_updated_at
    BEFORE UPDATE ON purchase_lines
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

INSERT INTO permissions (name, slug) VALUES
    ('Read tenant suppliers', 'tenant.suppliers.read'),
    ('Write tenant suppliers', 'tenant.suppliers.write'),
    ('Export tenant suppliers', 'tenant.suppliers.export'),
    ('Read tenant purchases', 'tenant.purchases.read'),
    ('Write tenant purchases', 'tenant.purchases.write'),
    ('Export tenant purchases', 'tenant.purchases.export')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.suppliers.read', 'tenant.suppliers.export',
    'tenant.purchases.read', 'tenant.purchases.export'
)
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.suppliers.read',
    'tenant.suppliers.write',
    'tenant.suppliers.export',
    'tenant.purchases.read',
    'tenant.purchases.write',
    'tenant.purchases.export'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
