-- Purchases (spec §3, §5, §6): orders, discount codes and their uses, and
-- the platform billing settings singleton (F3/F4 columns created now).

CREATE TABLE billing_settings (
    id                   SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    seller_name          VARCHAR(255) NOT NULL DEFAULT '',
    seller_tax_id        VARCHAR(20)  NOT NULL DEFAULT '',
    seller_tax_office    VARCHAR(120) NOT NULL DEFAULT '',
    seller_address       TEXT         NOT NULL DEFAULT '',
    seller_city          VARCHAR(80)  NOT NULL DEFAULT '',
    seller_email         VARCHAR(255) NOT NULL DEFAULT '',
    seller_phone         VARCHAR(40)  NOT NULL DEFAULT '',
    seller_website       VARCHAR(255) NOT NULL DEFAULT '',
    bank_name            VARCHAR(120) NOT NULL DEFAULT '',
    account_holder       VARCHAR(255) NOT NULL DEFAULT '',
    iban                 VARCHAR(34)  NOT NULL DEFAULT '',
    payment_instructions TEXT         NOT NULL DEFAULT '',
    order_ttl_days       INT          NOT NULL DEFAULT 3 CHECK (order_ttl_days BETWEEN 1 AND 30),
    grace_days           INT          NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 30),
    vat_rate             INT          NOT NULL DEFAULT 20 CHECK (vat_rate BETWEEN 0 AND 100),
    invoice_series       VARCHAR(3)   NOT NULL DEFAULT 'TWD',
    xslt_object_key      TEXT         NOT NULL DEFAULT '',
    reminder_days        INT[]        NOT NULL DEFAULT '{7,3,1}',
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
INSERT INTO billing_settings (id) VALUES (1);
CREATE TRIGGER trg_billing_settings_set_updated_at BEFORE UPDATE ON billing_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_discount_codes (
    id                  BIGSERIAL      PRIMARY KEY,
    uuid                UUID           NOT NULL DEFAULT gen_random_uuid(),
    code                VARCHAR(40)    NOT NULL,
    kind                VARCHAR(8)     NOT NULL,
    value               NUMERIC(18, 2) NOT NULL,
    applies_to_plans    BIGINT[]       NOT NULL DEFAULT '{}',
    applies_to_periods  TEXT[]         NOT NULL DEFAULT '{}',
    starts_at           TIMESTAMPTZ    NULL,
    ends_at             TIMESTAMPTZ    NULL,
    max_uses            INT            NULL,
    max_uses_per_org    INT            NULL,
    first_purchase_only BOOLEAN        NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN        NOT NULL DEFAULT TRUE,
    note                TEXT           NOT NULL DEFAULT '',
    created_by          BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_discount_codes_uuid UNIQUE (uuid),
    CONSTRAINT uq_billing_discount_codes_code UNIQUE (code),
    CONSTRAINT chk_billing_discount_codes_kind CHECK (kind IN ('percent', 'amount')),
    CONSTRAINT chk_billing_discount_codes_value CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
    CONSTRAINT chk_billing_discount_codes_upper CHECK (code = UPPER(code))
);
CREATE TRIGGER trg_billing_discount_codes_set_updated_at BEFORE UPDATE ON billing_discount_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_orders (
    id                   BIGSERIAL      PRIMARY KEY,
    uuid                 UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id      BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    plan_id              BIGINT         NOT NULL REFERENCES billing_plans (id),
    period               VARCHAR(8)     NOT NULL,
    kind                 VARCHAR(16)    NOT NULL,
    status               VARCHAR(20)    NOT NULL DEFAULT 'pending_payment',
    channel              VARCHAR(20)    NOT NULL DEFAULT 'bank_transfer',
    reference_code       VARCHAR(16)    NOT NULL,
    list_price           NUMERIC(18, 2) NOT NULL,
    proration_credit     NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_code_id     BIGINT         NULL REFERENCES billing_discount_codes (id) ON DELETE SET NULL,
    discount_code        VARCHAR(40)    NOT NULL DEFAULT '',
    discount_amount      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit_applied       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit_surplus       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total                NUMERIC(18, 2) NOT NULL,
    vat_rate             INT            NOT NULL,
    vat_amount           NUMERIC(18, 2) NOT NULL,
    lines                JSONB          NOT NULL DEFAULT '[]'::jsonb,
    starts_at            TIMESTAMPTZ    NOT NULL,
    ends_at              TIMESTAMPTZ    NOT NULL,
    receipt_object_key   TEXT           NOT NULL DEFAULT '',
    receipt_content_type VARCHAR(80)    NOT NULL DEFAULT '',
    report_note          TEXT           NOT NULL DEFAULT '',
    reported_at          TIMESTAMPTZ    NULL,
    reviewed_by          BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    reviewed_at          TIMESTAMPTZ    NULL,
    review_note          TEXT           NOT NULL DEFAULT '',
    reject_reason        TEXT           NOT NULL DEFAULT '',
    subscription_id      BIGINT         NULL REFERENCES billing_subscriptions (id) ON DELETE SET NULL,
    custom_features      JSONB          NOT NULL DEFAULT '{}'::jsonb,
    expires_at           TIMESTAMPTZ    NOT NULL,
    created_by           BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_orders_uuid UNIQUE (uuid),
    CONSTRAINT uq_billing_orders_reference UNIQUE (reference_code),
    CONSTRAINT chk_billing_orders_period CHECK (period IN ('monthly', 'yearly')),
    CONSTRAINT chk_billing_orders_kind CHECK (kind IN ('new', 'renew', 'upgrade', 'downgrade', 'period_change')),
    CONSTRAINT chk_billing_orders_status CHECK (status IN ('pending_payment', 'payment_reported', 'approved', 'rejected', 'cancelled', 'expired'))
);
CREATE UNIQUE INDEX uq_billing_orders_open ON billing_orders (organization_id)
    WHERE status IN ('pending_payment', 'payment_reported');
CREATE INDEX idx_billing_orders_status ON billing_orders (status, created_at DESC);
CREATE INDEX idx_billing_orders_expires ON billing_orders (expires_at) WHERE status = 'pending_payment';
CREATE TRIGGER trg_billing_orders_set_updated_at BEFORE UPDATE ON billing_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_discount_uses (
    id               BIGSERIAL      PRIMARY KEY,
    discount_code_id BIGINT         NOT NULL REFERENCES billing_discount_codes (id) ON DELETE CASCADE,
    organization_id  BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    order_id         BIGINT         NOT NULL REFERENCES billing_orders (id) ON DELETE CASCADE,
    amount           NUMERIC(18, 2) NOT NULL,
    used_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_discount_uses_order UNIQUE (order_id)
);
CREATE INDEX idx_billing_discount_uses_code ON billing_discount_uses (discount_code_id, organization_id);
