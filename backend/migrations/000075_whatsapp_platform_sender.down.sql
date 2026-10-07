DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'platform.integrations.whatsapp.read', 'platform.integrations.whatsapp.write'));
DELETE FROM permissions WHERE slug IN (
    'platform.integrations.whatsapp.read', 'platform.integrations.whatsapp.write');

-- Plan grants (trial + whatsapp-enabled plans) go with the feature.
DELETE FROM billing_plan_features WHERE feature_id IN (
    SELECT id FROM billing_features WHERE key = 'whatsapp.own_number');
DELETE FROM billing_features WHERE key = 'whatsapp.own_number';

DROP INDEX IF EXISTS idx_outbound_messages_provider_reference;
ALTER TABLE outbound_messages
    DROP COLUMN IF EXISTS sender_kind,
    DROP COLUMN IF EXISTS template_name,
    DROP COLUMN IF EXISTS delivery_status,
    DROP COLUMN IF EXISTS delivery_status_at,
    DROP COLUMN IF EXISTS pricing_category,
    DROP COLUMN IF EXISTS billable,
    DROP COLUMN IF EXISTS error_code;

ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS fallback_to_platform;

DROP TABLE IF EXISTS whatsapp_cloud_templates;
DROP TABLE IF EXISTS platform_whatsapp_settings;
