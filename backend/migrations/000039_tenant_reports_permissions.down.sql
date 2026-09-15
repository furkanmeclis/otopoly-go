DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.reports.read',
        'tenant.reports.export'
    )
);

DELETE FROM permissions
WHERE slug IN (
    'tenant.reports.read',
    'tenant.reports.export'
);
