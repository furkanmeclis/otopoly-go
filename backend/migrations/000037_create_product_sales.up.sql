CREATE TABLE product_sales (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    customer_id            BIGINT         NULL REFERENCES customers (id),
    customer_name          VARCHAR(150)   NOT NULL DEFAULT '',
    customer_phone         VARCHAR(32)    NOT NULL DEFAULT '',
    status                 VARCHAR(16)    NOT NULL DEFAULT 'posted',
    currency               CHAR(3)        NOT NULL DEFAULT 'TRY',
    total_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    method                 VARCHAR(16)    NOT NULL,
    finance_account_id     BIGINT         NULL REFERENCES finance_accounts (id),
    finance_transaction_id BIGINT         NULL REFERENCES finance_transactions (id),
    cari_entry_id          BIGINT         NULL REFERENCES cari_entries (id),
    notes                  TEXT           NOT NULL DEFAULT '',
    sold_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    created_by             BIGINT         NOT NULL REFERENCES users (id),
    voided_at              TIMESTAMPTZ    NULL,
    voided_by              BIGINT         NULL REFERENCES users (id),
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_sales_uuid UNIQUE (uuid),
    CONSTRAINT chk_product_sales_status CHECK (status IN ('posted', 'voided')),
    CONSTRAINT chk_product_sales_method CHECK (method IN ('cash', 'card', 'cari')),
    CONSTRAINT chk_product_sales_total CHECK (total_amount > 0),
    CONSTRAINT chk_product_sales_cari_customer CHECK (
        method <> 'cari' OR customer_id IS NOT NULL
    )
);

CREATE INDEX idx_product_sales_org_sold
    ON product_sales (organization_id, sold_at DESC);

CREATE INDEX idx_product_sales_org_status
    ON product_sales (organization_id, status, sold_at DESC);

CREATE INDEX idx_product_sales_customer
    ON product_sales (customer_id, sold_at DESC)
    WHERE customer_id IS NOT NULL;

CREATE TRIGGER trg_product_sales_set_updated_at
    BEFORE UPDATE ON product_sales
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_sale_lines (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    sale_id         BIGINT         NOT NULL REFERENCES product_sales (id) ON DELETE CASCADE,
    product_id      BIGINT         NOT NULL REFERENCES products (id),
    name            VARCHAR(200)   NOT NULL,
    unit_price      NUMERIC(18, 2) NOT NULL,
    qty             NUMERIC(18, 3) NOT NULL DEFAULT 1,
    vat_rate        NUMERIC(5, 2)  NOT NULL DEFAULT 0,
    line_total      NUMERIC(18, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    sort_order      INT            NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_sale_lines_uuid UNIQUE (uuid),
    CONSTRAINT chk_product_sale_lines_qty CHECK (qty > 0),
    CONSTRAINT chk_product_sale_lines_price CHECK (unit_price >= 0),
    CONSTRAINT chk_product_sale_lines_total CHECK (line_total >= 0)
);

CREATE INDEX idx_product_sale_lines_sale
    ON product_sale_lines (sale_id, sort_order);

CREATE TRIGGER trg_product_sale_lines_set_updated_at
    BEFORE UPDATE ON product_sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

INSERT INTO permissions (name, slug) VALUES
    ('Read tenant sales', 'tenant.sales.read'),
    ('Write tenant sales', 'tenant.sales.write'),
    ('Export tenant sales', 'tenant.sales.export')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.sales.read', 'tenant.sales.export')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.sales.read',
    'tenant.sales.write',
    'tenant.sales.export'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
