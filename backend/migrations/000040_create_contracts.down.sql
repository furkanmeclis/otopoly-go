DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'platform.contract_presets.read',
        'platform.contract_presets.write',
        'tenant.contracts.read',
        'tenant.contracts.write'
    )
);

DELETE FROM permissions WHERE slug IN (
    'platform.contract_presets.read',
    'platform.contract_presets.write',
    'tenant.contracts.read',
    'tenant.contracts.write'
);

DROP TABLE IF EXISTS contract_media;
DROP TABLE IF EXISTS contract_signatures;
DROP TABLE IF EXISTS contract_signers;
DROP TABLE IF EXISTS contract_instances;
DROP TABLE IF EXISTS contract_templates;
DROP TABLE IF EXISTS contract_presets;
