DELETE FROM user_roles
WHERE role_id IN (SELECT id FROM roles WHERE slug = 'organization_owner');

DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE slug IN ('organization_user', 'organization_owner'))
  AND permission_id IN (SELECT id FROM permissions WHERE slug IN ('tenant.finance.read', 'tenant.finance.write'));

DELETE FROM roles WHERE slug = 'organization_owner';

DELETE FROM permissions WHERE slug IN ('tenant.finance.read', 'tenant.finance.write');
