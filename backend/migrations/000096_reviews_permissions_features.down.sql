DELETE FROM message_template_defaults WHERE event_type IN ('review.request', 'review.low_score');
DELETE FROM message_templates WHERE event_type IN ('review.request', 'review.low_score');

-- Drops plan values and usage counters of the review features.
DELETE FROM billing_usage_counters WHERE feature_key IN ('reviews.enabled', 'reviews.monthly');
DELETE FROM billing_plan_features WHERE feature_id IN (
    SELECT id FROM billing_features WHERE key IN ('reviews.enabled', 'reviews.monthly'));
DELETE FROM billing_features WHERE key IN ('reviews.enabled', 'reviews.monthly');

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN ('tenant.reviews.read', 'tenant.reviews.write')
);
DELETE FROM permissions WHERE slug IN ('tenant.reviews.read', 'tenant.reviews.write');
