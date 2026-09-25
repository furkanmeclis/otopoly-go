-- Tenant quotes (teklifler): lines, status history, deliveries, reminders.
--
-- Status: draft → sent → viewed → accepted | rejected; expired (sweep job);
-- cancelled. Totals are computed server-side (decimal-safe) and stored.

-- Per-organization, per-year sequence for quote numbers (TKL-2026-0001).
-- Incremented with INSERT … ON CONFLICT DO UPDATE … RETURNING inside the
-- create transaction, so concurrent creates never share a number.
CREATE TABLE quote_counters (
    organization_id BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    year            INTEGER     NOT NULL,
    last_number     INTEGER     NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, year)
);

CREATE TABLE quotes (
    id                     BIGSERIAL      PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    number                 VARCHAR(32)    NOT NULL,
    customer_id            BIGINT         NOT NULL REFERENCES customers (id),
    lead_id                BIGINT         NULL REFERENCES leads (id) ON DELETE SET NULL,
    -- Vehicle: an existing customer vehicle, or free text (plate optional),
    -- optionally with a vehicle catalog model/year.
    vehicle_id             BIGINT         NULL REFERENCES customer_vehicles (id) ON DELETE SET NULL,
    vehicle_plate          VARCHAR(16)    NOT NULL DEFAULT '',
    vehicle_label          VARCHAR(200)   NOT NULL DEFAULT '',
    vehicle_model_id       BIGINT         NULL REFERENCES vehicle_models (id) ON DELETE SET NULL,
    vehicle_year           SMALLINT       NULL,
    status                 VARCHAR(16)    NOT NULL DEFAULT 'draft',
    currency               CHAR(3)        NOT NULL DEFAULT 'TRY',
    prices_include_vat     BOOLEAN        NOT NULL DEFAULT TRUE,
    discount_type          VARCHAR(8)     NOT NULL DEFAULT 'none',
    discount_value         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    subtotal               NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_total         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_total              NUMERIC(18, 2) NOT NULL DEFAULT 0,
    grand_total            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    valid_until            DATE           NULL,
    notes                  TEXT           NOT NULL DEFAULT '',
    terms                  TEXT           NOT NULL DEFAULT '',
    -- Unguessable public link token (not the uuid).
    share_token            VARCHAR(64)    NOT NULL,
    pdf_object_key         TEXT           NULL,
    pdf_sha256             VARCHAR(64)    NOT NULL DEFAULT '',
    sent_at                TIMESTAMPTZ    NULL,
    viewed_at              TIMESTAMPTZ    NULL,
    view_count             INTEGER        NOT NULL DEFAULT 0,
    accepted_at            TIMESTAMPTZ    NULL,
    rejected_at            TIMESTAMPTZ    NULL,
    expired_at             TIMESTAMPTZ    NULL,
    cancelled_at           TIMESTAMPTZ    NULL,
    decision_note          VARCHAR(1000)  NOT NULL DEFAULT '',
    decision_channel       VARCHAR(16)    NOT NULL DEFAULT '',
    decision_ip            VARCHAR(64)    NOT NULL DEFAULT '',
    decision_user_agent    VARCHAR(400)   NOT NULL DEFAULT '',
    job_id                 BIGINT         NULL REFERENCES service_jobs (id) ON DELETE SET NULL,
    converted_at           TIMESTAMPTZ    NULL,
    created_by             BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_quotes_uuid UNIQUE (uuid),
    CONSTRAINT uq_quotes_share_token UNIQUE (share_token),
    CONSTRAINT chk_quotes_status CHECK (status IN (
        'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled'
    )),
    CONSTRAINT chk_quotes_discount_type CHECK (discount_type IN ('none', 'percent', 'amount')),
    CONSTRAINT chk_quotes_discount_value CHECK (discount_value >= 0),
    CONSTRAINT chk_quotes_totals CHECK (
        subtotal >= 0 AND discount_total >= 0 AND vat_total >= 0 AND grand_total >= 0
    )
);

CREATE UNIQUE INDEX uq_quotes_org_number ON quotes (organization_id, number);
CREATE INDEX idx_quotes_org_status_created ON quotes (organization_id, status, created_at DESC);
CREATE INDEX idx_quotes_org_created ON quotes (organization_id, created_at DESC);
CREATE INDEX idx_quotes_org_customer ON quotes (organization_id, customer_id);
CREATE INDEX idx_quotes_lead ON quotes (lead_id) WHERE lead_id IS NOT NULL;
-- Expiry sweep: open quotes by valid_until.
CREATE INDEX idx_quotes_valid_until_open
    ON quotes (valid_until)
    WHERE valid_until IS NOT NULL AND status IN ('draft', 'sent', 'viewed');

CREATE TRIGGER trg_quotes_set_updated_at
    BEFORE UPDATE ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- line_type: service | product (catalog snapshot) | custom (free text).
-- Amounts: line_subtotal = qty × unit_price; line_discount (line level);
-- quote_discount_share (allocated quote-level discount); net_amount;
-- vat_amount; line_total (what the customer pays for the line).
CREATE TABLE quote_lines (
    id                    BIGSERIAL      PRIMARY KEY,
    uuid                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id       BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    quote_id              BIGINT         NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    line_type             VARCHAR(16)    NOT NULL DEFAULT 'custom',
    service_id            BIGINT         NULL REFERENCES services (id) ON DELETE SET NULL,
    product_id            BIGINT         NULL REFERENCES products (id) ON DELETE SET NULL,
    description           VARCHAR(300)   NOT NULL,
    quantity              NUMERIC(18, 3) NOT NULL DEFAULT 1,
    unit                  VARCHAR(32)    NOT NULL DEFAULT '',
    unit_price            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_type         VARCHAR(8)     NOT NULL DEFAULT 'none',
    discount_value        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_rate              NUMERIC(5, 2)  NOT NULL DEFAULT 20,
    line_subtotal         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    line_discount         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    quote_discount_share  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    net_amount            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_amount            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    line_total            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    sort_order            INTEGER        NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_quote_lines_uuid UNIQUE (uuid),
    CONSTRAINT chk_quote_lines_type CHECK (line_type IN ('service', 'product', 'custom')),
    CONSTRAINT chk_quote_lines_discount_type CHECK (discount_type IN ('none', 'percent', 'amount')),
    CONSTRAINT chk_quote_lines_qty CHECK (quantity > 0),
    CONSTRAINT chk_quote_lines_price CHECK (unit_price >= 0),
    CONSTRAINT chk_quote_lines_vat CHECK (vat_rate >= 0 AND vat_rate <= 100)
);

CREATE INDEX idx_quote_lines_quote ON quote_lines (quote_id, sort_order);

-- Append-only status/activity history.
CREATE TABLE quote_events (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    quote_id        BIGINT       NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    kind            VARCHAR(32)  NOT NULL,
    from_status     VARCHAR(16)  NOT NULL DEFAULT '',
    to_status       VARCHAR(16)  NOT NULL DEFAULT '',
    body            TEXT         NOT NULL DEFAULT '',
    channel         VARCHAR(16)  NOT NULL DEFAULT 'tenant',
    ip              VARCHAR(64)  NOT NULL DEFAULT '',
    user_agent      VARCHAR(400) NOT NULL DEFAULT '',
    actor_user_id   BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_quote_events_uuid UNIQUE (uuid)
);

CREATE INDEX idx_quote_events_quote_created ON quote_events (quote_id, created_at DESC, id DESC);

-- "Send to customer" attempts (QuoteMessenger). status: pending | sent | failed.
CREATE TABLE quote_deliveries (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    quote_id        BIGINT       NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    channel         VARCHAR(16)  NOT NULL DEFAULT 'whatsapp',
    recipient       VARCHAR(64)  NOT NULL DEFAULT '',
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    error           TEXT         NOT NULL DEFAULT '',
    provider_ref    VARCHAR(200) NOT NULL DEFAULT '',
    attempt_count   INTEGER      NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ  NULL,
    sent_at         TIMESTAMPTZ  NULL,
    created_by      BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_quote_deliveries_uuid UNIQUE (uuid),
    CONSTRAINT chk_quote_deliveries_status CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX idx_quote_deliveries_quote ON quote_deliveries (quote_id, created_at DESC);

CREATE TRIGGER trg_quote_deliveries_set_updated_at
    BEFORE UPDATE ON quote_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Desired reminders (ReminderScheduler). kind: before_3d | before_1d |
-- last_day | custom. status: pending (stored, not yet accepted by a
-- scheduler) | scheduled | sent | failed | cancelled.
CREATE TABLE quote_reminders (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    quote_id        BIGINT       NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
    kind            VARCHAR(16)  NOT NULL,
    offset_days     INTEGER      NOT NULL DEFAULT 0,
    fire_at         TIMESTAMPTZ  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    external_ref    VARCHAR(200) NOT NULL DEFAULT '',
    error           TEXT         NOT NULL DEFAULT '',
    sent_at         TIMESTAMPTZ  NULL,
    cancelled_at    TIMESTAMPTZ  NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_quote_reminders_uuid UNIQUE (uuid),
    CONSTRAINT chk_quote_reminders_kind CHECK (kind IN ('before_3d', 'before_1d', 'last_day', 'custom')),
    CONSTRAINT chk_quote_reminders_status CHECK (status IN ('pending', 'scheduled', 'sent', 'failed', 'cancelled'))
);

CREATE INDEX idx_quote_reminders_quote ON quote_reminders (quote_id, fire_at);
CREATE INDEX idx_quote_reminders_due
    ON quote_reminders (fire_at)
    WHERE status IN ('pending', 'scheduled');

CREATE TRIGGER trg_quote_reminders_set_updated_at
    BEFORE UPDATE ON quote_reminders
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
