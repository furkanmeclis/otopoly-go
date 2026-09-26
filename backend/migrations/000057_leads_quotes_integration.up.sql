-- Leads & quotes ↔ todos / notification center integration.
--
-- 1) Foreign keys for todos.lead_id / todos.quote_id (columns and indexes
--    come from 000053). Leads are soft-deleted (deleted_at) and quotes are
--    never hard-deleted by the app, so ON DELETE SET NULL only covers
--    organization purges / manual cleanup; soft-deleted leads are hidden by
--    the todo link resolver instead.
UPDATE todos t SET lead_id = NULL
WHERE t.lead_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = t.lead_id AND l.organization_id = t.organization_id);

UPDATE todos t SET quote_id = NULL
WHERE t.quote_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.id = t.quote_id AND q.organization_id = t.organization_id);

ALTER TABLE todos
    ADD CONSTRAINT fk_todos_lead FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_todos_quote FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_todos_org_lead ON todos (organization_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_org_quote ON todos (organization_id, quote_id) WHERE quote_id IS NOT NULL;

-- 2) Async WhatsApp outcome → quote delivery / reminder rows (matched by the
--    notification uuid stored in provider_ref / external_ref).
CREATE INDEX IF NOT EXISTS idx_quote_deliveries_provider_ref
    ON quote_deliveries (organization_id, provider_ref) WHERE provider_ref <> '';
CREATE INDEX IF NOT EXISTS idx_quote_reminders_external_ref
    ON quote_reminders (organization_id, external_ref) WHERE external_ref <> '';

-- 3) Team-facing quote notifications (in-app + e-mail, TR + EN).
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body) VALUES
('quote.team_created', 'inapp', 'tr', 'Yeni teklif: {{quote_number}}',
 '{{created_by_name}}, {{customer_name}} için {{quote_number}} numaralı teklifi oluşturdu ({{total_amount}}).'),
('quote.team_created', 'inapp', 'en', 'New quote: {{quote_number}}',
 '{{created_by_name}} created quote {{quote_number}} for {{customer_name}} ({{total_amount}}).'),
('quote.team_created', 'email', 'tr', 'Yeni teklif: {{quote_number}}',
 E'Merhaba {{assignee_name}},\n\n{{created_by_name}}, takip ettiğiniz {{customer_name}} için {{quote_number}} numaralı teklifi oluşturdu.\nTutar: {{total_amount}}\n\n{{app_link}}\n\n{{company_name}}'),
('quote.team_created', 'email', 'en', 'New quote: {{quote_number}}',
 E'Hello {{assignee_name}},\n\n{{created_by_name}} created quote {{quote_number}} for {{customer_name}}, whom you follow.\nTotal: {{total_amount}}\n\n{{app_link}}\n\n{{company_name}}'),
('quote.team_expiring', 'inapp', 'tr', 'Teklif yarın sona eriyor: {{quote_number}}',
 '{{customer_name}} için {{quote_number}} numaralı teklifin geçerliliği {{valid_until}} tarihinde bitiyor ({{total_amount}}).'),
('quote.team_expiring', 'inapp', 'en', 'Quote expires tomorrow: {{quote_number}}',
 'Quote {{quote_number}} for {{customer_name}} is valid until {{valid_until}} ({{total_amount}}).'),
('quote.team_expiring', 'email', 'tr', 'Teklif yarın sona eriyor: {{quote_number}}',
 E'Merhaba {{assignee_name}},\n\n{{customer_name}} için {{quote_number}} numaralı teklifin geçerliliği {{valid_until}} tarihinde bitiyor.\nTutar: {{total_amount}}\n\nMüşteriyle iletişime geçmek için: {{app_link}}\n\n{{company_name}}'),
('quote.team_expiring', 'email', 'en', 'Quote expires tomorrow: {{quote_number}}',
 E'Hello {{assignee_name}},\n\nQuote {{quote_number}} for {{customer_name}} is valid until {{valid_until}}.\nTotal: {{total_amount}}\n\nFollow up with the customer: {{app_link}}\n\n{{company_name}}')
ON CONFLICT (event_type, channel, locale) DO NOTHING;
