ALTER TABLE organizations
    ADD COLUMN invoice_name VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN invoice_tax_id VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN invoice_tax_office VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN invoice_address TEXT NOT NULL DEFAULT '',
    ADD COLUMN invoice_city VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN invoice_email VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE billing_settings
    ADD COLUMN xslt_uploaded_at TIMESTAMPTZ NULL;

CREATE TABLE billing_invoice_counters (
    series  VARCHAR(3) NOT NULL,
    year    INT        NOT NULL,
    last_no BIGINT     NOT NULL DEFAULT 0,
    PRIMARY KEY (series, year),
    CONSTRAINT chk_billing_invoice_counters_series CHECK (series ~ '^[A-Z0-9]{3}$')
);

CREATE TABLE billing_invoices (
    id               BIGSERIAL      PRIMARY KEY,
    uuid             UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id  BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    order_id         BIGINT         NOT NULL REFERENCES billing_orders (id) ON DELETE CASCADE,
    number           VARCHAR(16)    NOT NULL,
    issue_date       DATE           NOT NULL,
    profile          VARCHAR(20)    NOT NULL DEFAULT 'EARSIVFATURA',
    type             VARCHAR(12)    NOT NULL DEFAULT 'SATIS',
    buyer            JSONB          NOT NULL DEFAULT '{}'::jsonb,
    seller           JSONB          NOT NULL DEFAULT '{}'::jsonb,
    lines            JSONB          NOT NULL DEFAULT '[]'::jsonb,
    subtotal         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_total   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_total        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    grand_total      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    xml_object_key   TEXT           NOT NULL DEFAULT '',
    pdf_object_key   TEXT           NOT NULL DEFAULT '',
    xslt_version     VARCHAR(40)    NOT NULL DEFAULT '',
    status           VARCHAR(12)    NOT NULL DEFAULT 'issued',
    error            TEXT           NOT NULL DEFAULT '',
    voided_at        TIMESTAMPTZ    NULL,
    voided_by        BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_invoices_uuid UNIQUE (uuid),
    CONSTRAINT uq_billing_invoices_order UNIQUE (order_id),
    CONSTRAINT uq_billing_invoices_number UNIQUE (number),
    CONSTRAINT chk_billing_invoices_status CHECK (status IN ('issued', 'failed', 'voided')),
    CONSTRAINT chk_billing_invoices_profile CHECK (profile = 'EARSIVFATURA'),
    CONSTRAINT chk_billing_invoices_type CHECK (type = 'SATIS')
);

CREATE INDEX idx_billing_invoices_org_created
    ON billing_invoices (organization_id, created_at DESC);
CREATE INDEX idx_billing_invoices_status_created
    ON billing_invoices (status, created_at DESC);

CREATE TRIGGER trg_billing_invoices_set_updated_at
    BEFORE UPDATE ON billing_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
