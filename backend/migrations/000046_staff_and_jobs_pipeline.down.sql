ALTER TABLE service_jobs DROP CONSTRAINT IF EXISTS chk_service_jobs_payment_status;

UPDATE service_jobs SET status = 'done' WHERE status = 'ready';
UPDATE service_jobs SET status = 'paid' WHERE status = 'delivered' AND payment_status = 'paid';
UPDATE service_jobs SET status = 'done' WHERE status = 'delivered' AND payment_status = 'unpaid';

ALTER TABLE service_jobs DROP CONSTRAINT IF EXISTS chk_service_jobs_status;
ALTER TABLE service_jobs
    ADD CONSTRAINT chk_service_jobs_status CHECK (
        status IN ('in_progress', 'done', 'paid', 'cancelled', 'voided')
    );

ALTER TABLE service_jobs DROP COLUMN IF EXISTS payment_status;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.staff.read',
        'tenant.staff.write'
    )
);

-- Do not revoke kasa write grants on down (safe leave).

DELETE FROM permissions WHERE slug IN ('tenant.staff.read', 'tenant.staff.write');
