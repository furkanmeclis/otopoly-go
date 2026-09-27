-- Products a service uses (recipe): one job line of the service consumes
-- qty × line qty of each product from stock.
CREATE TABLE service_products (
    id              BIGSERIAL      PRIMARY KEY,
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    service_id      BIGINT         NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    product_id      BIGINT         NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    qty             NUMERIC(18, 3) NOT NULL,
    sort_order      INT            NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_products UNIQUE (service_id, product_id),
    CONSTRAINT chk_service_products_qty CHECK (qty > 0)
);

CREATE INDEX idx_service_products_org_service ON service_products (organization_id, service_id);

CREATE TRIGGER trg_service_products_set_updated_at
    BEFORE UPDATE ON service_products
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Products used on a job (from service recipes or added by staff).
-- stock_applied: stock was decremented (tracked product); reverted_at: the
-- job was cancelled / voided and the stock given back.
CREATE TABLE service_job_consumptions (
    id              BIGSERIAL      PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    job_id          BIGINT         NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    product_id      BIGINT         NOT NULL REFERENCES products (id),
    service_id      BIGINT         NULL REFERENCES services (id) ON DELETE SET NULL,
    name            VARCHAR(200)   NOT NULL,
    unit            VARCHAR(32)    NOT NULL DEFAULT '',
    qty             NUMERIC(18, 3) NOT NULL,
    unit_cost       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    stock_applied   BOOLEAN        NOT NULL DEFAULT FALSE,
    reverted_at     TIMESTAMPTZ    NULL,
    created_by      BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_job_consumptions_uuid UNIQUE (uuid),
    CONSTRAINT chk_service_job_consumptions_qty CHECK (qty > 0)
);

CREATE INDEX idx_service_job_consumptions_job ON service_job_consumptions (organization_id, job_id);

CREATE TRIGGER trg_service_job_consumptions_set_updated_at
    BEFORE UPDATE ON service_job_consumptions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
