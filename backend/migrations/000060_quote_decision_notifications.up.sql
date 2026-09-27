-- Team notices when a customer accepts / rejects a quote via the share link
-- (creator, lead assignee and owners; in-app + e-mail, TR + EN).
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body) VALUES
('quote.team_accepted', 'inapp', 'tr', 'Teklif onaylandı: {{quote_number}}',
 '{{customer_name}}, {{quote_number}} numaralı teklifi onayladı ({{total_amount}}).'),
('quote.team_accepted', 'inapp', 'en', 'Quote accepted: {{quote_number}}',
 '{{customer_name}} accepted quote {{quote_number}} ({{total_amount}}).'),
('quote.team_accepted', 'email', 'tr', 'Teklif onaylandı: {{quote_number}}',
 E'Merhaba,\n\n{{customer_name}}, {{quote_number}} numaralı teklifi onayladı.\nTutar: {{total_amount}}\n\nİşe dönüştürmek için: {{app_link}}\n\n{{company_name}}'),
('quote.team_accepted', 'email', 'en', 'Quote accepted: {{quote_number}}',
 E'Hello,\n\n{{customer_name}} accepted quote {{quote_number}}.\nTotal: {{total_amount}}\n\nConvert it into a job: {{app_link}}\n\n{{company_name}}'),
('quote.team_rejected', 'inapp', 'tr', 'Teklif reddedildi: {{quote_number}}',
 '{{customer_name}}, {{quote_number}} numaralı teklifi reddetti ({{total_amount}}).'),
('quote.team_rejected', 'inapp', 'en', 'Quote rejected: {{quote_number}}',
 '{{customer_name}} rejected quote {{quote_number}} ({{total_amount}}).'),
('quote.team_rejected', 'email', 'tr', 'Teklif reddedildi: {{quote_number}}',
 E'Merhaba,\n\n{{customer_name}}, {{quote_number}} numaralı teklifi reddetti.\nTutar: {{total_amount}}\n\n{{app_link}}\n\n{{company_name}}'),
('quote.team_rejected', 'email', 'en', 'Quote rejected: {{quote_number}}',
 E'Hello,\n\n{{customer_name}} rejected quote {{quote_number}}.\nTotal: {{total_amount}}\n\n{{app_link}}\n\n{{company_name}}')
ON CONFLICT (event_type, channel, locale) DO NOTHING;
