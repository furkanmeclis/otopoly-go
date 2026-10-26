-- Stock reorder suggestions: organization settings, per-supplier lead time,
-- per-product overrides, draft purchases and the stock_reorder.enabled plan
-- toggle.

-- Draft purchases: created from reorder suggestions, they change neither
-- stock nor finance until posted (status draft → posted through the normal
-- purchase flow). A draft may still have a zero total (unknown cost).
ALTER TABLE purchases DROP CONSTRAINT chk_purchases_status;
ALTER TABLE purchases ADD CONSTRAINT chk_purchases_status
    CHECK (status IN ('draft', 'posted', 'voided'));
ALTER TABLE purchases DROP CONSTRAINT chk_purchases_total;
ALTER TABLE purchases ADD CONSTRAINT chk_purchases_total
    CHECK (total_amount > 0 OR (status = 'draft' AND total_amount >= 0));

CREATE INDEX idx_purchases_org_drafts
    ON purchases (organization_id, created_at DESC)
    WHERE status = 'draft';

CREATE TABLE stock_reorder_settings (
    organization_id  BIGINT      PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
    velocity_days    INT         NOT NULL DEFAULT 30,
    lead_days        INT         NOT NULL DEFAULT 3,
    target_days      INT         NOT NULL DEFAULT 14,
    notify_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
    last_notified_on DATE        NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_reorder_velocity_days CHECK (velocity_days BETWEEN 7 AND 365),
    CONSTRAINT chk_stock_reorder_lead_days CHECK (lead_days BETWEEN 0 AND 180),
    CONSTRAINT chk_stock_reorder_target_days CHECK (target_days BETWEEN 1 AND 365)
);

CREATE TRIGGER trg_stock_reorder_settings_set_updated_at
    BEFORE UPDATE ON stock_reorder_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Supplier lead time (days from order to delivery).
CREATE TABLE stock_reorder_supplier_settings (
    supplier_id     BIGINT      PRIMARY KEY REFERENCES suppliers (id) ON DELETE CASCADE,
    organization_id BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    lead_days       INT         NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_reorder_supplier_lead_days CHECK (lead_days BETWEEN 0 AND 180)
);

CREATE INDEX idx_stock_reorder_supplier_settings_org
    ON stock_reorder_supplier_settings (organization_id);

CREATE TRIGGER trg_stock_reorder_supplier_settings_set_updated_at
    BEFORE UPDATE ON stock_reorder_supplier_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Per-product overrides: preferred supplier, lead time, target cover and
-- pack size (suggested quantities are rounded up to whole packs). NULL keeps
-- the organization / supplier value.
CREATE TABLE stock_reorder_product_settings (
    product_id      BIGINT         PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    supplier_id     BIGINT         NULL REFERENCES suppliers (id) ON DELETE SET NULL,
    lead_days       INT            NULL,
    target_days     INT            NULL,
    pack_size       NUMERIC(18, 3) NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_stock_reorder_product_lead_days CHECK (lead_days IS NULL OR lead_days BETWEEN 0 AND 180),
    CONSTRAINT chk_stock_reorder_product_target_days CHECK (target_days IS NULL OR target_days BETWEEN 1 AND 365),
    CONSTRAINT chk_stock_reorder_product_pack_size CHECK (pack_size IS NULL OR pack_size > 0)
);

CREATE INDEX idx_stock_reorder_product_settings_org
    ON stock_reorder_product_settings (organization_id);

CREATE TRIGGER trg_stock_reorder_product_settings_set_updated_at
    BEFORE UPDATE ON stock_reorder_product_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Velocity reads consumptions and sales of the last N days per product.
CREATE INDEX IF NOT EXISTS idx_service_job_consumptions_org_product_created
    ON service_job_consumptions (organization_id, product_id, created_at)
    WHERE reverted_at IS NULL;

-- Plan toggle: reorder suggestions. Undefined = on; the code upserts it at
-- boot too.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('stock_reorder.enabled', 'toggle', '', 'none', 'Stok sipariş önerileri', 'Stock reorder suggestions', 95, TRUE)
ON CONFLICT (key) DO NOTHING;
