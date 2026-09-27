DROP TABLE IF EXISTS billing_usage_counters;
DROP TABLE IF EXISTS billing_subscriptions;
DROP TABLE IF EXISTS billing_plan_features;
DROP TABLE IF EXISTS billing_plans;
DROP TABLE IF EXISTS billing_features;
DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'platform.billing.read', 'platform.billing.write', 'platform.billing.settings',
        'tenant.billing.read', 'tenant.billing.write'));
DELETE FROM permissions WHERE slug IN (
    'platform.billing.read', 'platform.billing.write', 'platform.billing.settings',
    'tenant.billing.read', 'tenant.billing.write');
