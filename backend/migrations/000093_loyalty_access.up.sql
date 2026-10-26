-- Loyalty and packages: permissions, plan toggle and reminder templates.

-- tenant.loyalty.read   see campaigns, packages, subscriptions, a customer's
--                       stamps / credits (owner + staff)
-- tenant.loyalty.apply  use them: apply rewards / credits on jobs, sell a
--                       package, start a subscription, collect a period
--                       payment (owner + staff)
-- tenant.loyalty.write  manage programs and cancel packages / subscriptions
--                       (owner)
INSERT INTO permissions (name, slug) VALUES
    ('Read tenant loyalty', 'tenant.loyalty.read'),
    ('Apply tenant loyalty', 'tenant.loyalty.apply'),
    ('Write tenant loyalty', 'tenant.loyalty.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.loyalty.read', 'tenant.loyalty.apply', 'tenant.loyalty.write')
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.loyalty.read', 'tenant.loyalty.apply')
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

-- Plan toggle. No plan values are inserted: an undefined toggle is on, so
-- existing plans keep the module. Code also upserts the row at boot.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('loyalty.enabled', 'toggle', '', 'none', 'Sadakat ve paketler', 'Loyalty & packages', 95, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Subscription renewal reminders: the customer (WhatsApp / SMS through the
-- organization's notification rules) and the team (in-app / e-mail).
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body) VALUES
('loyalty.renewal_reminder', 'whatsapp', 'tr', 'Abonelik Yenileme Hatırlatması',
 E'Sayın {{customer_name}},\n\n{{plan_name}} aboneliğinizin yenileme tarihi {{renewal_date}}. Tutar: {{amount}} {{currency}}\n\nBizi tercih ettiğiniz için teşekkürler.\n{{company_name}}'),
('loyalty.renewal_reminder', 'whatsapp', 'en', 'Subscription renewal reminder',
 E'Dear {{customer_name}},\n\nYour {{plan_name}} subscription renews on {{renewal_date}}. Amount: {{amount}} {{currency}}\n\nThank you for choosing us.\n{{company_name}}'),
('loyalty.renewal_reminder', 'sms', 'tr', 'Abonelik Yenileme Hatırlatması',
 '{{plan_name}} aboneliginizin yenileme tarihi {{renewal_date}}. Tutar: {{amount}} {{currency}} - {{company_name}}'),
('loyalty.renewal_reminder', 'sms', 'en', 'Subscription renewal reminder',
 'Your {{plan_name}} subscription renews on {{renewal_date}}. Amount: {{amount}} {{currency}} - {{company_name}}'),
('loyalty.team_renewal_due', 'inapp', 'tr', 'Abonelik yenilemesi yaklaşıyor: {{customer_name}}',
 '{{plan_name}} — yenileme {{renewal_date}}, {{amount}} {{currency}}.'),
('loyalty.team_renewal_due', 'inapp', 'en', 'Subscription renewal coming up: {{customer_name}}',
 '{{plan_name}} — renews {{renewal_date}}, {{amount}} {{currency}}.'),
('loyalty.team_renewal_due', 'email', 'tr', 'Abonelik yenilemesi yaklaşıyor: {{customer_name}}',
 E'{{customer_name}} müşterisinin {{plan_name}} aboneliği {{renewal_date}} tarihinde yenileniyor ({{amount}} {{currency}}).\n\n{{app_link}}\n\n{{company_name}}'),
('loyalty.team_renewal_due', 'email', 'en', 'Subscription renewal coming up: {{customer_name}}',
 E'The {{plan_name}} subscription of {{customer_name}} renews on {{renewal_date}} ({{amount}} {{currency}}).\n\n{{app_link}}\n\n{{company_name}}')
ON CONFLICT (event_type, channel, locale) DO NOTHING;
