CREATE TABLE vehicle_brands (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    logo_object_key TEXT         NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_vehicle_brands_uuid UNIQUE (uuid)
);

CREATE UNIQUE INDEX uq_vehicle_brands_name_active
    ON vehicle_brands (lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX idx_vehicle_brands_active
    ON vehicle_brands (is_active)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_vehicle_brands_set_updated_at
    BEFORE UPDATE ON vehicle_brands
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE vehicle_models (
    id         BIGSERIAL PRIMARY KEY,
    uuid       UUID         NOT NULL DEFAULT gen_random_uuid(),
    brand_id   BIGINT       NOT NULL REFERENCES vehicle_brands (id) ON DELETE RESTRICT,
    name       VARCHAR(200) NOT NULL,
    is_active  BOOLEAN      NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ  NULL,
    CONSTRAINT uq_vehicle_models_uuid UNIQUE (uuid)
);

CREATE UNIQUE INDEX uq_vehicle_models_brand_name_active
    ON vehicle_models (brand_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX idx_vehicle_models_brand
    ON vehicle_models (brand_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_vehicle_models_set_updated_at
    BEFORE UPDATE ON vehicle_models
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE vehicle_model_years (
    model_id BIGINT   NOT NULL REFERENCES vehicle_models (id) ON DELETE CASCADE,
    year     SMALLINT NOT NULL,
    PRIMARY KEY (model_id, year),
    CONSTRAINT chk_vehicle_model_years_year CHECK (year >= 1900 AND year <= 2100)
);

CREATE INDEX idx_vehicle_model_years_year
    ON vehicle_model_years (year);

INSERT INTO permissions (name, slug) VALUES
    ('Read vehicle brands', 'platform.vehicle_brands.read'),
    ('Write vehicle brands', 'platform.vehicle_brands.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'platform.vehicle_brands.read',
    'platform.vehicle_brands.write'
)
WHERE r.slug = 'super_admin'
ON CONFLICT DO NOTHING;
