CREATE TABLE catalog_categories (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    parent_id       BIGINT       NULL REFERENCES catalog_categories (id) ON DELETE SET NULL,
    name            VARCHAR(100) NOT NULL,
    kind            VARCHAR(16)  NOT NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_catalog_categories_uuid UNIQUE (uuid),
    CONSTRAINT chk_catalog_categories_kind CHECK (kind IN ('product', 'service'))
);

CREATE UNIQUE INDEX uq_catalog_categories_org_name_kind_active
    ON catalog_categories (organization_id, kind, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX idx_catalog_categories_org
    ON catalog_categories (organization_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_catalog_categories_set_updated_at
    BEFORE UPDATE ON catalog_categories
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    category_id     BIGINT         NULL REFERENCES catalog_categories (id) ON DELETE SET NULL,
    name            VARCHAR(150)   NOT NULL,
    sku             VARCHAR(64)    NULL,
    barcode         VARCHAR(64)    NULL,
    unit            VARCHAR(32)    NOT NULL DEFAULT 'piece',
    cost_price      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    sale_price      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_rate        NUMERIC(5, 2)  NOT NULL DEFAULT 20,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    stock_quantity  NUMERIC(18, 3) NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC(18, 3) NOT NULL DEFAULT 0,
    track_stock     BOOLEAN        NOT NULL DEFAULT true,
    is_active       BOOLEAN        NOT NULL DEFAULT true,
    description     TEXT           NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ    NULL,
    CONSTRAINT uq_products_uuid UNIQUE (uuid),
    CONSTRAINT chk_products_currency CHECK (char_length(currency) = 3),
    CONSTRAINT chk_products_cost_price CHECK (cost_price >= 0),
    CONSTRAINT chk_products_sale_price CHECK (sale_price >= 0),
    CONSTRAINT chk_products_vat_rate CHECK (vat_rate >= 0)
);

CREATE UNIQUE INDEX uq_products_org_name_active
    ON products (organization_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_products_org_sku_active
    ON products (organization_id, lower(sku))
    WHERE deleted_at IS NULL AND sku IS NOT NULL AND sku <> '';

CREATE UNIQUE INDEX uq_products_org_barcode_active
    ON products (organization_id, lower(barcode))
    WHERE deleted_at IS NULL AND barcode IS NOT NULL AND barcode <> '';

CREATE INDEX idx_products_org
    ON products (organization_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_products_org_category
    ON products (organization_id, category_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_products_set_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE services (
    id               BIGSERIAL PRIMARY KEY,
    uuid             UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id  BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    category_id      BIGINT         NULL REFERENCES catalog_categories (id) ON DELETE SET NULL,
    name             VARCHAR(150)   NOT NULL,
    code             VARCHAR(64)    NULL,
    duration_minutes INT            NOT NULL DEFAULT 30,
    price            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_rate         NUMERIC(5, 2)  NOT NULL DEFAULT 20,
    currency         CHAR(3)        NOT NULL DEFAULT 'TRY',
    is_active        BOOLEAN        NOT NULL DEFAULT true,
    description      TEXT           NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ    NULL,
    CONSTRAINT uq_services_uuid UNIQUE (uuid),
    CONSTRAINT chk_services_currency CHECK (char_length(currency) = 3),
    CONSTRAINT chk_services_price CHECK (price >= 0),
    CONSTRAINT chk_services_vat_rate CHECK (vat_rate >= 0),
    CONSTRAINT chk_services_duration CHECK (duration_minutes >= 0)
);

CREATE UNIQUE INDEX uq_services_org_name_active
    ON services (organization_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_services_org_code_active
    ON services (organization_id, lower(code))
    WHERE deleted_at IS NULL AND code IS NOT NULL AND code <> '';

CREATE INDEX idx_services_org
    ON services (organization_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_services_org_category
    ON services (organization_id, category_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_services_set_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
