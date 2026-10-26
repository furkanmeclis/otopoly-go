-- Loyalty and packages (Sadakat ve Paketler): stamp campaigns, prepaid
-- service packages and wash subscriptions, plus what a job used of them.
-- Every table is organization-owned; queries always filter organization_id.

-- Stamp campaigns ("10 yıkama 1 bedava"). Eligible services / categories are
-- organization-scoped id arrays resolved from uuids by the use case.
CREATE TABLE loyalty_campaigns (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id     BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name                VARCHAR(150)   NOT NULL,
    description         TEXT           NOT NULL DEFAULT '',
    service_ids         BIGINT[]       NOT NULL DEFAULT '{}',
    category_ids        BIGINT[]       NOT NULL DEFAULT '{}',
    stamps_required     INT            NOT NULL,
    reward_type         VARCHAR(16)    NOT NULL,
    reward_service_id   BIGINT         NULL REFERENCES services (id) ON DELETE SET NULL,
    reward_value        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    valid_from          DATE           NULL,
    valid_until         DATE           NULL,
    is_active           BOOLEAN        NOT NULL DEFAULT true,
    per_customer_limit  INT            NULL,
    created_by          BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ    NULL,
    CONSTRAINT uq_loyalty_campaigns_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_campaigns_stamps CHECK (stamps_required BETWEEN 1 AND 100),
    CONSTRAINT chk_loyalty_campaigns_reward_type CHECK (reward_type IN ('free_service', 'percent', 'fixed')),
    CONSTRAINT chk_loyalty_campaigns_reward_value CHECK (
        (reward_type = 'percent' AND reward_value > 0 AND reward_value <= 100)
        OR (reward_type = 'fixed' AND reward_value > 0)
        OR reward_type = 'free_service'
    ),
    CONSTRAINT chk_loyalty_campaigns_window CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
    CONSTRAINT chk_loyalty_campaigns_limit CHECK (per_customer_limit IS NULL OR per_customer_limit > 0)
);

CREATE INDEX idx_loyalty_campaigns_org ON loyalty_campaigns (organization_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_loyalty_campaigns_set_updated_at
    BEFORE UPDATE ON loyalty_campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stamp ledger per campaign and customer. The balance is SUM(stamps):
-- earn (+1 per delivered and paid job with an eligible line), reverse_earn
-- (job voided), redeem (-stamps_required when a reward is used on a job) and
-- unredeem (the redemption was reverted). Earning and its reversal are
-- idempotent per job.
CREATE TABLE loyalty_stamp_events (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID        NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    campaign_id     BIGINT      NOT NULL REFERENCES loyalty_campaigns (id) ON DELETE CASCADE,
    customer_id     BIGINT      NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    job_id          BIGINT      NULL REFERENCES service_jobs (id) ON DELETE SET NULL,
    kind            VARCHAR(16) NOT NULL,
    stamps          INT         NOT NULL,
    created_by      BIGINT      NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loyalty_stamp_events_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_stamp_events_kind CHECK (kind IN ('earn', 'reverse_earn', 'redeem', 'unredeem'))
);

CREATE UNIQUE INDEX uq_loyalty_stamp_events_job_once
    ON loyalty_stamp_events (campaign_id, job_id, kind)
    WHERE job_id IS NOT NULL AND kind IN ('earn', 'reverse_earn');

CREATE INDEX idx_loyalty_stamp_events_customer
    ON loyalty_stamp_events (organization_id, customer_id, campaign_id);

-- Prepaid package definitions (e.g. 10x İç-dış yıkama for 2.500 TRY).
CREATE TABLE loyalty_packages (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            VARCHAR(150)   NOT NULL,
    description     TEXT           NOT NULL DEFAULT '',
    price           NUMERIC(18, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    validity_days   INT            NULL,
    is_active       BOOLEAN        NOT NULL DEFAULT true,
    created_by      BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ    NULL,
    CONSTRAINT uq_loyalty_packages_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_packages_price CHECK (price > 0),
    CONSTRAINT chk_loyalty_packages_validity CHECK (validity_days IS NULL OR validity_days BETWEEN 1 AND 3650)
);

CREATE INDEX idx_loyalty_packages_org ON loyalty_packages (organization_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_loyalty_packages_set_updated_at
    BEFORE UPDATE ON loyalty_packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE loyalty_package_items (
    id              BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    package_id      BIGINT NOT NULL REFERENCES loyalty_packages (id) ON DELETE CASCADE,
    service_id      BIGINT NOT NULL REFERENCES services (id),
    quantity        INT    NOT NULL,
    sort_order      INT    NOT NULL DEFAULT 0,
    CONSTRAINT uq_loyalty_package_items_service UNIQUE (package_id, service_id),
    CONSTRAINT chk_loyalty_package_items_qty CHECK (quantity BETWEEN 1 AND 1000)
);

-- A package sold to a customer. status stores active / cancelled; expired
-- (expires_at passed) and used_up (no credits left) are derived.
CREATE TABLE loyalty_customer_packages (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    package_id             BIGINT         NULL REFERENCES loyalty_packages (id) ON DELETE SET NULL,
    customer_id            BIGINT         NOT NULL REFERENCES customers (id),
    name                   VARCHAR(150)   NOT NULL,
    price                  NUMERIC(18, 2) NOT NULL,
    currency               CHAR(3)        NOT NULL DEFAULT 'TRY',
    status                 VARCHAR(16)    NOT NULL DEFAULT 'active',
    purchased_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    expires_at             TIMESTAMPTZ    NULL,
    payment_method         VARCHAR(16)    NOT NULL,
    finance_account_id     BIGINT         NULL REFERENCES finance_accounts (id),
    finance_transaction_id BIGINT         NULL REFERENCES finance_transactions (id),
    cari_entry_id          BIGINT         NULL REFERENCES cari_entries (id),
    notes                  TEXT           NOT NULL DEFAULT '',
    created_by             BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    cancelled_at           TIMESTAMPTZ    NULL,
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loyalty_customer_packages_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_customer_packages_status CHECK (status IN ('active', 'cancelled')),
    CONSTRAINT chk_loyalty_customer_packages_method CHECK (payment_method IN ('cash', 'card', 'cari'))
);

CREATE INDEX idx_loyalty_customer_packages_customer
    ON loyalty_customer_packages (organization_id, customer_id, purchased_at DESC);

CREATE TRIGGER trg_loyalty_customer_packages_set_updated_at
    BEFORE UPDATE ON loyalty_customer_packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE loyalty_customer_package_credits (
    id                  BIGSERIAL PRIMARY KEY,
    organization_id     BIGINT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    customer_package_id BIGINT NOT NULL REFERENCES loyalty_customer_packages (id) ON DELETE CASCADE,
    service_id          BIGINT NOT NULL REFERENCES services (id),
    service_name        VARCHAR(150) NOT NULL,
    total               INT    NOT NULL,
    used                INT    NOT NULL DEFAULT 0,
    CONSTRAINT uq_loyalty_customer_package_credits UNIQUE (customer_package_id, service_id),
    CONSTRAINT chk_loyalty_customer_package_credits_used CHECK (used >= 0 AND used <= total)
);

-- Subscription plans (monthly wash club): price per period, included uses
-- per period (NULL = unlimited) and eligible services / categories.
CREATE TABLE loyalty_subscription_plans (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            VARCHAR(150)   NOT NULL,
    description     TEXT           NOT NULL DEFAULT '',
    price           NUMERIC(18, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    period_months   INT            NOT NULL DEFAULT 1,
    uses_per_period INT            NULL,
    service_ids     BIGINT[]       NOT NULL DEFAULT '{}',
    category_ids    BIGINT[]       NOT NULL DEFAULT '{}',
    is_active       BOOLEAN        NOT NULL DEFAULT true,
    created_by      BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ    NULL,
    CONSTRAINT uq_loyalty_subscription_plans_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_subscription_plans_price CHECK (price > 0),
    CONSTRAINT chk_loyalty_subscription_plans_period CHECK (period_months BETWEEN 1 AND 12),
    CONSTRAINT chk_loyalty_subscription_plans_uses CHECK (uses_per_period IS NULL OR uses_per_period BETWEEN 1 AND 1000)
);

CREATE INDEX idx_loyalty_subscription_plans_org ON loyalty_subscription_plans (organization_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_loyalty_subscription_plans_set_updated_at
    BEFORE UPDATE ON loyalty_subscription_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A customer's subscription. Periods are anchored on start_date
-- (start + n * period_months, clamped to month end). paid_through is the end
-- (exclusive) of the last paid period: the renewal date. status stores
-- active / cancelled; past_due (active and paid_through <= today) is derived.
CREATE TABLE loyalty_subscriptions (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    plan_id         BIGINT         NULL REFERENCES loyalty_subscription_plans (id) ON DELETE SET NULL,
    customer_id     BIGINT         NOT NULL REFERENCES customers (id),
    vehicle_id      BIGINT         NULL REFERENCES customer_vehicles (id) ON DELETE SET NULL,
    name            VARCHAR(150)   NOT NULL,
    price           NUMERIC(18, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    period_months   INT            NOT NULL DEFAULT 1,
    uses_per_period INT            NULL,
    start_date      DATE           NOT NULL,
    paid_through    DATE           NOT NULL,
    status          VARCHAR(16)    NOT NULL DEFAULT 'active',
    notes           TEXT           NOT NULL DEFAULT '',
    created_by      BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    cancelled_at    TIMESTAMPTZ    NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loyalty_subscriptions_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_subscriptions_status CHECK (status IN ('active', 'cancelled')),
    CONSTRAINT chk_loyalty_subscriptions_period CHECK (period_months BETWEEN 1 AND 12),
    CONSTRAINT chk_loyalty_subscriptions_paid_through CHECK (paid_through >= start_date)
);

CREATE INDEX idx_loyalty_subscriptions_customer
    ON loyalty_subscriptions (organization_id, customer_id);

CREATE INDEX idx_loyalty_subscriptions_renewal
    ON loyalty_subscriptions (organization_id, paid_through)
    WHERE status = 'active';

CREATE TRIGGER trg_loyalty_subscriptions_set_updated_at
    BEFORE UPDATE ON loyalty_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One payment per subscription period (manual collection: cash / card / cari).
CREATE TABLE loyalty_subscription_payments (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    subscription_id        BIGINT         NOT NULL REFERENCES loyalty_subscriptions (id) ON DELETE CASCADE,
    period_start           DATE           NOT NULL,
    period_end             DATE           NOT NULL,
    amount                 NUMERIC(18, 2) NOT NULL,
    currency               CHAR(3)        NOT NULL DEFAULT 'TRY',
    method                 VARCHAR(16)    NOT NULL,
    finance_account_id     BIGINT         NULL REFERENCES finance_accounts (id),
    finance_transaction_id BIGINT         NULL REFERENCES finance_transactions (id),
    cari_entry_id          BIGINT         NULL REFERENCES cari_entries (id),
    created_by             BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loyalty_subscription_payments_uuid UNIQUE (uuid),
    CONSTRAINT uq_loyalty_subscription_payments_period UNIQUE (subscription_id, period_start),
    CONSTRAINT chk_loyalty_subscription_payments_method CHECK (method IN ('cash', 'card', 'cari')),
    CONSTRAINT chk_loyalty_subscription_payments_range CHECK (period_end > period_start)
);

-- Loyalty applied to a job line: a stamp reward, package credits or
-- subscription uses. The line keeps its gross price; discount_amount on the
-- line is what loyalty covered. Reverting (or cancelling / voiding the job)
-- gives the credits / uses / stamps back.
CREATE TABLE loyalty_applications (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id     BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    job_id              BIGINT         NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    job_line_id         BIGINT         NOT NULL REFERENCES service_job_lines (id) ON DELETE CASCADE,
    customer_id         BIGINT         NOT NULL REFERENCES customers (id),
    kind                VARCHAR(16)    NOT NULL,
    campaign_id         BIGINT         NULL REFERENCES loyalty_campaigns (id) ON DELETE SET NULL,
    customer_package_id BIGINT         NULL REFERENCES loyalty_customer_packages (id) ON DELETE SET NULL,
    credit_id           BIGINT         NULL REFERENCES loyalty_customer_package_credits (id) ON DELETE SET NULL,
    subscription_id     BIGINT         NULL REFERENCES loyalty_subscriptions (id) ON DELETE SET NULL,
    period_start        DATE           NULL,
    source_name         VARCHAR(150)   NOT NULL DEFAULT '',
    units               INT            NOT NULL DEFAULT 1,
    discount_amount     NUMERIC(18, 2) NOT NULL,
    status              VARCHAR(16)    NOT NULL DEFAULT 'applied',
    created_by          BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    reverted_at         TIMESTAMPTZ    NULL,
    reverted_by         BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT uq_loyalty_applications_uuid UNIQUE (uuid),
    CONSTRAINT chk_loyalty_applications_kind CHECK (kind IN ('reward', 'package', 'subscription')),
    CONSTRAINT chk_loyalty_applications_status CHECK (status IN ('applied', 'reverted')),
    CONSTRAINT chk_loyalty_applications_units CHECK (units >= 1),
    CONSTRAINT chk_loyalty_applications_discount CHECK (discount_amount >= 0)
);

-- At most one active application per job line.
CREATE UNIQUE INDEX uq_loyalty_applications_line_active
    ON loyalty_applications (job_line_id) WHERE status = 'applied';

CREATE INDEX idx_loyalty_applications_job ON loyalty_applications (organization_id, job_id);
CREATE INDEX idx_loyalty_applications_subscription
    ON loyalty_applications (subscription_id, period_start) WHERE status = 'applied';
CREATE INDEX idx_loyalty_applications_customer ON loyalty_applications (organization_id, customer_id, created_at DESC);

-- Job lines remember what loyalty covered: line_total = unit_price * qty -
-- discount_amount (never negative), discount_source names the program.
ALTER TABLE service_job_lines
    ADD COLUMN discount_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN discount_source VARCHAR(16) NULL,
    ADD CONSTRAINT chk_service_job_lines_discount CHECK (discount_amount >= 0),
    ADD CONSTRAINT chk_service_job_lines_discount_source CHECK (
        discount_source IS NULL OR discount_source IN ('reward', 'package', 'subscription')
    );
