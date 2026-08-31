DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE slug = 'tenant.finance.export');

DELETE FROM permissions WHERE slug = 'tenant.finance.export';

DROP INDEX IF EXISTS idx_export_jobs_organization;

ALTER TABLE export_jobs DROP COLUMN IF EXISTS organization_id;
