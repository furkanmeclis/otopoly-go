-- Staff permissions + kasa write for organization_user + jobs pipeline split.

INSERT INTO permissions (name, slug) VALUES
    ('Read tenant staff', 'tenant.staff.read'),
    ('Write tenant staff', 'tenant.staff.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.staff.read')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.staff.read',
    'tenant.staff.write'
)
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;

-- Kasa staff: write jobs/customers/sales/contracts (void stays owner-gated in HTTP).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN (
    'tenant.jobs.write',
    'tenant.customers.write',
    'tenant.sales.write',
    'tenant.contracts.write'
)
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

-- Jobs: payment_status independent of operational status.
ALTER TABLE service_jobs
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid';

ALTER TABLE service_jobs DROP CONSTRAINT IF EXISTS chk_service_jobs_status;
ALTER TABLE service_jobs DROP CONSTRAINT IF EXISTS chk_service_jobs_payment_status;

UPDATE service_jobs
SET payment_status = 'paid'
WHERE status = 'paid' AND payment_status = 'unpaid';

UPDATE service_jobs
SET status = 'delivered'
WHERE status = 'paid';

UPDATE service_jobs
SET status = 'ready'
WHERE status = 'done';

ALTER TABLE service_jobs
    ADD CONSTRAINT chk_service_jobs_status CHECK (
        status IN ('in_progress', 'ready', 'delivered', 'cancelled', 'voided')
    );

ALTER TABLE service_jobs
    ADD CONSTRAINT chk_service_jobs_payment_status CHECK (
        payment_status IN ('unpaid', 'paid')
    );
