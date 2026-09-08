CREATE TABLE customers (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    phone           VARCHAR(32)  NOT NULL DEFAULT '',
    email           VARCHAR(255) NOT NULL DEFAULT '',
    kind            VARCHAR(16)  NOT NULL DEFAULT 'individual',
    notes           TEXT         NOT NULL DEFAULT '',
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_customers_uuid UNIQUE (uuid),
    CONSTRAINT chk_customers_kind CHECK (kind IN ('individual', 'company'))
);

CREATE INDEX idx_customers_org
    ON customers (organization_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_customers_org_name
    ON customers (organization_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_customers_set_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_vehicles (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    customer_id     BIGINT       NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    plate           VARCHAR(16)  NOT NULL,
    model_id        BIGINT       NOT NULL,
    year            SMALLINT     NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_customer_vehicles_uuid UNIQUE (uuid),
    CONSTRAINT fk_customer_vehicles_model_year
        FOREIGN KEY (model_id, year) REFERENCES vehicle_model_years (model_id, year) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_customer_vehicles_org_plate_active
    ON customer_vehicles (organization_id, plate)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_customer_vehicles_customer
    ON customer_vehicles (customer_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_customer_vehicles_set_updated_at
    BEFORE UPDATE ON customer_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

INSERT INTO permissions (name, slug) VALUES
    ('Read tenant customers', 'tenant.customers.read'),
    ('Write tenant customers', 'tenant.customers.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.customers.read'
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.customers.read',
    'tenant.customers.write'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
