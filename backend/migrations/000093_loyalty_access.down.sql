DELETE FROM message_template_defaults
WHERE event_type IN ('loyalty.renewal_reminder', 'loyalty.team_renewal_due');

DELETE FROM message_templates
WHERE event_type IN ('loyalty.renewal_reminder', 'loyalty.team_renewal_due');

DELETE FROM billing_plan_features
WHERE feature_id IN (SELECT id FROM billing_features WHERE key = 'loyalty.enabled');
DELETE FROM billing_features WHERE key = 'loyalty.enabled';

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE slug IN ('tenant.loyalty.read', 'tenant.loyalty.apply', 'tenant.loyalty.write')
);
DELETE FROM permissions
WHERE slug IN ('tenant.loyalty.read', 'tenant.loyalty.apply', 'tenant.loyalty.write');
