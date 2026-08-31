ALTER TABLE export_jobs
    ADD COLUMN organization_id BIGINT NULL REFERENCES organizations (id) ON DELETE CASCADE;

CREATE INDEX idx_export_jobs_organization
    ON export_jobs (organization_id, created_at DESC)
    WHERE organization_id IS NOT NULL;

INSERT INTO permissions (name, slug) VALUES
    ('Export tenant finance', 'tenant.finance.export')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.finance.export'
WHERE r.slug IN ('organization_user', 'organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;
