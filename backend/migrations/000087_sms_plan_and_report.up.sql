-- SMS plan features, SMS segment counts on the outbound log, and the
-- platform SMS report permission.

-- sms.enabled (toggle) and sms.monthly (monthly SMS parts / segments). No
-- plan values are inserted: an undefined toggle is on and an undefined limit
-- is unlimited, so existing plans keep sending. Code upserts the rows at boot.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('sms.enabled', 'toggle', '',      'none',  'SMS gönderimi',            'SMS messaging',          65, TRUE),
    ('sms.monthly', 'limit',  'parça', 'month', 'Aylık SMS (parça)',        'Monthly SMS (segments)', 66, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Billed SMS parts of a sent message (NULL for WhatsApp and unsent rows).
ALTER TABLE outbound_messages
    ADD COLUMN segments INTEGER NULL;

CREATE INDEX idx_outbound_messages_sms_created
    ON outbound_messages (created_at, organization_id)
    WHERE channel = 'sms';

INSERT INTO permissions (name, slug) VALUES
    ('Read the platform SMS report', 'platform.messaging.sms.read')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug = 'platform.messaging.sms.read'
WHERE r.slug = 'super_admin' ON CONFLICT DO NOTHING;
