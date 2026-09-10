DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.jobs.read',
        'tenant.jobs.write',
        'tenant.jobs.export'
    )
);

DELETE FROM permissions
WHERE slug IN (
    'tenant.jobs.read',
    'tenant.jobs.write',
    'tenant.jobs.export'
);

DROP TABLE IF EXISTS service_job_payments;
DROP TABLE IF EXISTS service_job_lines;
DROP TABLE IF EXISTS service_jobs;
