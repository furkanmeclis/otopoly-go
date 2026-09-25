-- Tenant leads (potansiyel müşteri / fırsat) and their timeline.
--
-- A lead always points at an organization customer (picked or created
-- inline). Status: new → contacted → quoted → won | lost (lost_reason).
-- Temperature: cold | warm | hot. Every change is appended to lead_events.

CREATE TABLE leads (
    id               BIGSERIAL    PRIMARY KEY,
    uuid             UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id  BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    customer_id      BIGINT       NOT NULL REFERENCES customers (id),
    vehicle_id       BIGINT       NULL REFERENCES customer_vehicles (id) ON DELETE SET NULL,
    vehicle_text     VARCHAR(200) NOT NULL DEFAULT '',
    interest         VARCHAR(300) NOT NULL DEFAULT '',
    source           VARCHAR(24)  NOT NULL DEFAULT 'other',
    temperature      VARCHAR(8)   NOT NULL DEFAULT 'warm',
    status           VARCHAR(16)  NOT NULL DEFAULT 'new',
    lost_reason      VARCHAR(500) NOT NULL DEFAULT '',
    notes            TEXT         NOT NULL DEFAULT '',
    follow_up_date   DATE         NULL,
    assignee_user_id BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_by       BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    contacted_at     TIMESTAMPTZ  NULL,
    closed_at        TIMESTAMPTZ  NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ  NULL,
    CONSTRAINT uq_leads_uuid UNIQUE (uuid),
    CONSTRAINT chk_leads_source CHECK (source IN (
        'incoming_call', 'outgoing_call', 'walk_in', 'whatsapp',
        'social', 'referral', 'website', 'other'
    )),
    CONSTRAINT chk_leads_temperature CHECK (temperature IN ('cold', 'warm', 'hot')),
    CONSTRAINT chk_leads_status CHECK (status IN ('new', 'contacted', 'quoted', 'won', 'lost'))
);

CREATE INDEX idx_leads_org_status_created
    ON leads (organization_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_leads_org_created
    ON leads (organization_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_leads_org_customer
    ON leads (organization_id, customer_id)
    WHERE deleted_at IS NULL;

-- Follow-up queue: open leads by follow-up date (overdue / today filters, nav badge).
CREATE INDEX idx_leads_org_follow_up_open
    ON leads (organization_id, follow_up_date)
    WHERE deleted_at IS NULL AND status IN ('new', 'contacted', 'quoted');

CREATE TRIGGER trg_leads_set_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Append-only timeline. kind: created | status_changed | temperature_changed |
-- assignee_changed | follow_up_changed | note | quote_created | quote_sent |
-- quote_accepted | quote_rejected | todo_created | job_created | updated.
CREATE TABLE lead_events (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    lead_id         BIGINT       NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    kind            VARCHAR(32)  NOT NULL,
    from_value      VARCHAR(200) NOT NULL DEFAULT '',
    to_value        VARCHAR(200) NOT NULL DEFAULT '',
    body            TEXT         NOT NULL DEFAULT '',
    ref_type        VARCHAR(16)  NOT NULL DEFAULT '',
    ref_uuid        UUID         NULL,
    ref_label       VARCHAR(200) NOT NULL DEFAULT '',
    actor_user_id   BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lead_events_uuid UNIQUE (uuid)
);

CREATE INDEX idx_lead_events_lead_created
    ON lead_events (lead_id, created_at DESC, id DESC);
