DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug = 'platform.messaging.sms.read');
DELETE FROM permissions WHERE slug = 'platform.messaging.sms.read';

DROP INDEX IF EXISTS idx_outbound_messages_sms_created;
ALTER TABLE outbound_messages DROP COLUMN IF EXISTS segments;

-- Drops plan values and usage counters of the SMS features.
DELETE FROM billing_usage_counters WHERE feature_key IN ('sms.enabled', 'sms.monthly');
DELETE FROM billing_plan_features WHERE feature_id IN (
    SELECT id FROM billing_features WHERE key IN ('sms.enabled', 'sms.monthly'));
DELETE FROM billing_features WHERE key IN ('sms.enabled', 'sms.monthly');
