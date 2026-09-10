CREATE TABLE service_jobs (
    id                BIGSERIAL PRIMARY KEY,
    uuid              UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id   BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    customer_id       BIGINT         NOT NULL REFERENCES customers (id),
    vehicle_id        BIGINT         NOT NULL REFERENCES customer_vehicles (id),
    customer_name     VARCHAR(150)   NOT NULL DEFAULT '',
    customer_phone    VARCHAR(32)    NOT NULL DEFAULT '',
    plate             VARCHAR(16)    NOT NULL DEFAULT '',
    vehicle_label     VARCHAR(255)   NOT NULL DEFAULT '',
    status            VARCHAR(16)    NOT NULL DEFAULT 'in_progress',
    currency          CHAR(3)        NOT NULL DEFAULT 'TRY',
    notes             TEXT           NOT NULL DEFAULT '',
    started_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ    NULL,
    paid_at           TIMESTAMPTZ    NULL,
    assignee_user_id  BIGINT         NULL REFERENCES users (id),
    total_amount      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    created_by        BIGINT         NOT NULL REFERENCES users (id),
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_jobs_uuid UNIQUE (uuid),
    CONSTRAINT chk_service_jobs_status CHECK (
        status IN ('in_progress', 'done', 'paid', 'cancelled', 'voided')
    ),
    CONSTRAINT chk_service_jobs_total CHECK (total_amount >= 0)
);

CREATE INDEX idx_service_jobs_org_started
    ON service_jobs (organization_id, started_at DESC);

CREATE INDEX idx_service_jobs_org_status
    ON service_jobs (organization_id, status, started_at DESC);

CREATE INDEX idx_service_jobs_customer
    ON service_jobs (customer_id, started_at DESC);

CREATE INDEX idx_service_jobs_plate
    ON service_jobs (organization_id, plate);

CREATE TRIGGER trg_service_jobs_set_updated_at
    BEFORE UPDATE ON service_jobs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE service_job_lines (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    job_id          BIGINT         NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    line_type       VARCHAR(16)    NOT NULL DEFAULT 'service',
    service_id      BIGINT         NULL REFERENCES services (id),
    product_id      BIGINT         NULL REFERENCES products (id),
    name            VARCHAR(200)   NOT NULL,
    unit_price      NUMERIC(18, 2) NOT NULL,
    qty             NUMERIC(18, 3) NOT NULL DEFAULT 1,
    vat_rate        NUMERIC(5, 2)  NOT NULL DEFAULT 0,
    line_total      NUMERIC(18, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'TRY',
    sort_order      INT            NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_job_lines_uuid UNIQUE (uuid),
    CONSTRAINT chk_service_job_lines_type CHECK (line_type IN ('service', 'product')),
    CONSTRAINT chk_service_job_lines_qty CHECK (qty > 0),
    CONSTRAINT chk_service_job_lines_price CHECK (unit_price >= 0),
    CONSTRAINT chk_service_job_lines_total CHECK (line_total >= 0)
);

CREATE INDEX idx_service_job_lines_job
    ON service_job_lines (job_id, sort_order);

CREATE TRIGGER trg_service_job_lines_set_updated_at
    BEFORE UPDATE ON service_job_lines
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE service_job_payments (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id        BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    job_id                 BIGINT         NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    method                 VARCHAR(16)    NOT NULL,
    amount                 NUMERIC(18, 2) NOT NULL,
    currency               CHAR(3)        NOT NULL DEFAULT 'TRY',
    status                 VARCHAR(16)    NOT NULL DEFAULT 'posted',
    finance_account_id     BIGINT         NULL REFERENCES finance_accounts (id),
    finance_transaction_id BIGINT         NULL REFERENCES finance_transactions (id),
    cari_entry_id          BIGINT         NULL REFERENCES cari_entries (id),
    created_by             BIGINT         NOT NULL REFERENCES users (id),
    voided_at              TIMESTAMPTZ    NULL,
    voided_by              BIGINT         NULL REFERENCES users (id),
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_job_payments_uuid UNIQUE (uuid),
    CONSTRAINT chk_service_job_payments_method CHECK (method IN ('cash', 'card', 'cari')),
    CONSTRAINT chk_service_job_payments_status CHECK (status IN ('posted', 'void')),
    CONSTRAINT chk_service_job_payments_amount CHECK (amount > 0)
);

CREATE INDEX idx_service_job_payments_job
    ON service_job_payments (job_id);

CREATE INDEX idx_service_job_payments_status
    ON service_job_payments (organization_id, status);

CREATE TRIGGER trg_service_job_payments_set_updated_at
    BEFORE UPDATE ON service_job_payments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

INSERT INTO permissions (name, slug) VALUES
    ('Read tenant jobs', 'tenant.jobs.read'),
    ('Write tenant jobs', 'tenant.jobs.write'),
    ('Export tenant jobs', 'tenant.jobs.export')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.jobs.read', 'tenant.jobs.export')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.jobs.read',
    'tenant.jobs.write',
    'tenant.jobs.export'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
