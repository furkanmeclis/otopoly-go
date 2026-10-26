-- Review collection: permissions, plan features and default message texts.

-- tenant.reviews.read for owners and staff, tenant.reviews.write for owners
-- (the HTTP layer also requires the owner role for writes).
INSERT INTO permissions (name, slug) VALUES
    ('Read tenant reviews', 'tenant.reviews.read'),
    ('Write tenant reviews', 'tenant.reviews.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.reviews.read'
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.reviews.read', 'tenant.reviews.write')
WHERE r.slug IN ('organization_owner', 'super_admin')
ON CONFLICT DO NOTHING;

-- reviews.enabled (toggle) and reviews.monthly (review requests sent per
-- month). No plan values: an undefined toggle is on and an undefined limit is
-- unlimited, so existing plans keep working. Code upserts the rows at boot.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('reviews.enabled', 'toggle', '',      'none',  'Değerlendirme toplama',          'Review collection',         95, TRUE),
    ('reviews.monthly', 'limit',  'istek', 'month', 'Aylık değerlendirme isteği',     'Monthly review requests',   96, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Customer review request ({{musteri_adi}}, {{isletme_adi}}, {{link}}) and the
-- team notice for low scores.
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body) VALUES
('review.request', 'whatsapp', 'tr', 'Değerlendirme isteği',
 E'Merhaba {{musteri_adi}},\n\n{{isletme_adi}} olarak bizi tercih ettiğiniz için teşekkür ederiz. Hizmetimizi 1 dakikada değerlendirir misiniz?\n{{link}}'),
('review.request', 'whatsapp', 'en', 'Review request',
 E'Hi {{musteri_adi}},\n\nThank you for choosing {{isletme_adi}}. Could you take a minute to rate our service?\n{{link}}'),
('review.request', 'sms', 'tr', 'Değerlendirme isteği',
 'Merhaba {{musteri_adi}}, {{isletme_adi}} hizmetini değerlendirir misiniz? {{link}}'),
('review.request', 'sms', 'en', 'Review request',
 'Hi {{musteri_adi}}, how was your service at {{isletme_adi}}? Rate us: {{link}}'),
('review.low_score', 'inapp', 'tr', 'Düşük puan: {{score}}/5',
 '{{customer_name}} {{score}} puan verdi. Müşteriyle iletişime geçin.'),
('review.low_score', 'inapp', 'en', 'Low score: {{score}}/5',
 '{{customer_name}} gave {{score}} stars. Please get in touch.'),
('review.low_score', 'email', 'tr', 'Düşük puanlı değerlendirme: {{score}}/5',
 E'Merhaba,\n\n{{customer_name}} ({{plate}}) hizmetinize {{score}} puan verdi.\nYorum: {{comment}}\n\nMüşteriyle iletişime geçip değerlendirmeyi "ele alındı" olarak işaretleyin: {{app_link}}\n\n{{company_name}}'),
('review.low_score', 'email', 'en', 'Low score review: {{score}}/5',
 E'Hello,\n\n{{customer_name}} ({{plate}}) rated your service {{score}} stars.\nComment: {{comment}}\n\nGet in touch with the customer and mark the review as handled: {{app_link}}\n\n{{company_name}}')
ON CONFLICT (event_type, channel, locale) DO NOTHING;
