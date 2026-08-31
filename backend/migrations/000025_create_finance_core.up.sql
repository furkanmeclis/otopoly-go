-- TODO(finance): Follow-up migration — backfill default kasa/categories for orgs created before 000025;
-- optional partial indexes on (organization_id, transaction_date DESC) for high-volume tenants.

CREATE TABLE finance_accounts (
    id               BIGSERIAL PRIMARY KEY,
    uuid             UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id  BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name             VARCHAR(100)   NOT NULL,
    type             VARCHAR(32)    NOT NULL,
    currency         CHAR(3)        NOT NULL DEFAULT 'TRY',
    opening_balance  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    current_balance  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    is_default       BOOLEAN        NOT NULL DEFAULT false,
    is_active        BOOLEAN        NOT NULL DEFAULT true,
    bank_name        VARCHAR(100)   NULL,
    iban             VARCHAR(34)    NULL,
    notes            TEXT           NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ    NULL,
    CONSTRAINT uq_finance_accounts_uuid UNIQUE (uuid),
    CONSTRAINT chk_finance_accounts_type CHECK (type IN ('cash', 'bank')),
    CONSTRAINT chk_finance_accounts_currency CHECK (char_length(currency) = 3)
);

CREATE UNIQUE INDEX uq_finance_accounts_org_name_active
    ON finance_accounts (organization_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX idx_finance_accounts_org
    ON finance_accounts (organization_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_finance_accounts_set_updated_at
    BEFORE UPDATE ON finance_accounts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE finance_categories (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    parent_id       BIGINT       NULL REFERENCES finance_categories (id) ON DELETE SET NULL,
    name            VARCHAR(100) NOT NULL,
    kind            VARCHAR(16)  NOT NULL,
    sort_order      INT          NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_finance_categories_uuid UNIQUE (uuid),
    CONSTRAINT chk_finance_categories_kind CHECK (kind IN ('income', 'expense'))
);

CREATE UNIQUE INDEX uq_finance_categories_org_name_kind_active
    ON finance_categories (organization_id, kind, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX idx_finance_categories_org
    ON finance_categories (organization_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_finance_categories_set_updated_at
    BEFORE UPDATE ON finance_categories
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE finance_transactions (
    id                 BIGSERIAL PRIMARY KEY,
    uuid               UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    type               VARCHAR(16)    NOT NULL,
    status             VARCHAR(16)    NOT NULL DEFAULT 'posted',
    account_id         BIGINT         NOT NULL REFERENCES finance_accounts (id),
    counter_account_id BIGINT         NULL REFERENCES finance_accounts (id),
    category_id        BIGINT         NULL REFERENCES finance_categories (id),
    amount             NUMERIC(18, 2) NOT NULL,
    currency           CHAR(3)        NOT NULL,
    transaction_date   DATE           NOT NULL,
    description        TEXT           NOT NULL DEFAULT '',
    reference_no       VARCHAR(64)    NULL,
    payment_method     VARCHAR(32)    NOT NULL DEFAULT 'cash',
    created_by         BIGINT         NOT NULL REFERENCES users (id),
    voided_at          TIMESTAMPTZ    NULL,
    voided_by          BIGINT         NULL REFERENCES users (id),
    source_type        VARCHAR(32)    NULL,
    source_uuid        UUID           NULL,
    metadata           JSONB          NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_finance_transactions_uuid UNIQUE (uuid),
    CONSTRAINT chk_finance_transactions_type CHECK (type IN ('income', 'expense', 'transfer')),
    CONSTRAINT chk_finance_transactions_status CHECK (status IN ('posted', 'void')),
    CONSTRAINT chk_finance_transactions_amount CHECK (amount > 0),
    CONSTRAINT chk_finance_transactions_payment_method CHECK (
        payment_method IN ('cash', 'card', 'transfer', 'other')
    )
);

CREATE INDEX idx_finance_transactions_org_date
    ON finance_transactions (organization_id, transaction_date DESC);

CREATE INDEX idx_finance_transactions_org_account
    ON finance_transactions (organization_id, account_id);

CREATE INDEX idx_finance_transactions_org_type_status
    ON finance_transactions (organization_id, type, status);

CREATE INDEX idx_finance_transactions_source
    ON finance_transactions (source_type, source_uuid)
    WHERE source_type IS NOT NULL;

CREATE TRIGGER trg_finance_transactions_set_updated_at
    BEFORE UPDATE ON finance_transactions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
