DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'tenant.cari.read',
        'tenant.cari.write',
        'tenant.cari.export'
    )
);

DELETE FROM permissions
WHERE slug IN (
    'tenant.cari.read',
    'tenant.cari.write',
    'tenant.cari.export'
);

UPDATE finance_categories
SET deleted_at = NOW(), is_active = false
WHERE lower(name) = lower('Cari Tahsilat')
  AND deleted_at IS NULL;

DROP TABLE IF EXISTS cari_entries;
DROP TABLE IF EXISTS cari_accounts;
