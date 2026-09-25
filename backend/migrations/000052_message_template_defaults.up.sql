-- System default message/notification templates (TR + EN). Organization rows
-- in message_templates are overrides; deleting an override resets to these.
CREATE TABLE message_template_defaults (
    id         BIGSERIAL    PRIMARY KEY,
    event_type VARCHAR(64)  NOT NULL,
    channel    VARCHAR(32)  NOT NULL,
    locale     VARCHAR(8)   NOT NULL,
    subject    VARCHAR(200) NOT NULL DEFAULT '',
    body       TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_message_template_defaults UNIQUE (event_type, channel, locale),
    CONSTRAINT chk_message_template_defaults_channel CHECK (channel IN ('inapp', 'email', 'whatsapp', 'sms')),
    CONSTRAINT chk_message_template_defaults_locale CHECK (locale IN ('tr', 'en'))
);

CREATE TRIGGER trg_message_template_defaults_updated_at
    BEFORE UPDATE ON message_template_defaults
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Customer-facing WhatsApp texts.
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body) VALUES
('job.created', 'whatsapp', 'tr', 'Aracınız Kabul Edildi',
 E'Sayın {{customer_name}},\n\nAracınız ({{plate}}) servisimize alındı. İş No: {{job_id}}\n\nGelişmeleri size bildireceğiz.\n{{company_name}}'),
('job.created', 'whatsapp', 'en', 'Your vehicle was received',
 E'Dear {{customer_name}},\n\nYour vehicle ({{plate}}) has been checked in. Job no: {{job_id}}\n\nWe will keep you posted.\n{{company_name}}'),
('contract.signed', 'whatsapp', 'tr', 'Sözleşmeniz İmzalandı',
 E'Sayın {{customer_name}},\n\n"{{contract_title}}" sözleşmeniz başarıyla imzalandı.\nPlaka: {{plate}}\n\nİyi günler dileriz.\n{{company_name}}'),
('contract.signed', 'whatsapp', 'en', 'Your contract was signed',
 E'Dear {{customer_name}},\n\nYour contract "{{contract_title}}" has been signed.\nPlate: {{plate}}\n\nHave a nice day.\n{{company_name}}'),
('job.ready', 'whatsapp', 'tr', 'Aracınız Hazır',
 E'Sayın {{customer_name}},\n\nAracınızın işlemi tamamlandı, teslime hazır.\nİş No: {{job_id}} | Plaka: {{plate}}\n\nİyi günler dileriz.\n{{company_name}}'),
('job.ready', 'whatsapp', 'en', 'Your vehicle is ready',
 E'Dear {{customer_name}},\n\nYour vehicle is ready for pickup.\nJob no: {{job_id}} | Plate: {{plate}}\n\nHave a nice day.\n{{company_name}}'),
('job.delivered', 'whatsapp', 'tr', 'Aracınız Teslim Edildi',
 E'Sayın {{customer_name}},\n\nAracınız ({{plate}}) teslim edildi. İş No: {{job_id}}\n\nBizi tercih ettiğiniz için teşekkürler.\n{{company_name}}'),
('job.delivered', 'whatsapp', 'en', 'Your vehicle was delivered',
 E'Dear {{customer_name}},\n\nYour vehicle ({{plate}}) has been delivered. Job no: {{job_id}}\n\nThank you for choosing us.\n{{company_name}}'),
('job.paid', 'whatsapp', 'tr', 'Ödemeniz Alındı',
 E'Sayın {{customer_name}},\n\nÖdemeniz başarıyla alındı. Tutar: {{amount}} {{currency}}\nPlaka: {{plate}}\n\nTeşekkür ederiz.\n{{company_name}}'),
('job.paid', 'whatsapp', 'en', 'Payment received',
 E'Dear {{customer_name}},\n\nWe received your payment. Amount: {{amount}} {{currency}}\nPlate: {{plate}}\n\nThank you.\n{{company_name}}'),
('job.cancelled', 'whatsapp', 'tr', 'İşlem İptal Edildi',
 E'Sayın {{customer_name}},\n\n{{plate}} plakalı aracınız için işlem iptal edildi. İş No: {{job_id}}\n\nSorularınız için bize ulaşabilirsiniz.\n{{company_name}}'),
('job.cancelled', 'whatsapp', 'en', 'Job cancelled',
 E'Dear {{customer_name}},\n\nThe job for your vehicle {{plate}} was cancelled. Job no: {{job_id}}\n\nContact us with any questions.\n{{company_name}}'),
('sale.created', 'whatsapp', 'tr', 'Satışınız Oluşturuldu',
 E'Sayın {{customer_name}},\n\nSatışınız oluşturuldu. Tutar: {{amount}} {{currency}}\n\nTeşekkür ederiz.\n{{company_name}}'),
('sale.created', 'whatsapp', 'en', 'Your purchase was recorded',
 E'Dear {{customer_name}},\n\nYour purchase was recorded. Amount: {{amount}} {{currency}}\n\nThank you.\n{{company_name}}'),
('quote.created', 'whatsapp', 'tr', 'Teklifiniz Hazırlandı',
 E'Sayın {{customer_name}},\n\n{{quote_number}} numaralı teklifiniz hazırlandı.\nTutar: {{total_amount}}\nGeçerlilik: {{valid_until}}\n\n{{company_name}}'),
('quote.created', 'whatsapp', 'en', 'Your quote is ready',
 E'Dear {{customer_name}},\n\nYour quote {{quote_number}} has been prepared.\nTotal: {{total_amount}}\nValid until: {{valid_until}}\n\n{{company_name}}'),
('quote.sent', 'whatsapp', 'tr', 'Teklifiniz',
 E'Sayın {{customer_name}},\n\n{{quote_number}} numaralı teklifimizi ekte / bağlantıda bulabilirsiniz: {{quote_link}}\nTutar: {{total_amount}}\nGeçerlilik: {{valid_until}}\n\n{{company_name}}'),
('quote.sent', 'whatsapp', 'en', 'Your quote',
 E'Dear {{customer_name}},\n\nPlease find our quote {{quote_number}} attached or at: {{quote_link}}\nTotal: {{total_amount}}\nValid until: {{valid_until}}\n\n{{company_name}}'),
('quote.reminder', 'whatsapp', 'tr', 'Teklif Hatırlatması',
 E'Sayın {{customer_name}},\n\n{{quote_number}} numaralı teklifimizi hatırlatmak isteriz: {{quote_link}}\nTutar: {{total_amount}}\n\nSorularınız için bize ulaşabilirsiniz.\n{{company_name}}'),
('quote.reminder', 'whatsapp', 'en', 'Quote reminder',
 E'Dear {{customer_name}},\n\nA friendly reminder about our quote {{quote_number}}: {{quote_link}}\nTotal: {{total_amount}}\n\nFeel free to contact us with any questions.\n{{company_name}}'),
('quote.expiring', 'whatsapp', 'tr', 'Teklifinizin Süresi Doluyor',
 E'Sayın {{customer_name}},\n\n{{quote_number}} numaralı teklifimizin geçerliliği {{valid_until}} tarihinde sona eriyor: {{quote_link}}\n\n{{company_name}}'),
('quote.expiring', 'whatsapp', 'en', 'Your quote expires soon',
 E'Dear {{customer_name}},\n\nOur quote {{quote_number}} expires on {{valid_until}}: {{quote_link}}\n\n{{company_name}}');

-- SMS mirrors the WhatsApp text.
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body)
SELECT event_type, 'sms', locale, subject, body
FROM message_template_defaults WHERE channel = 'whatsapp';

-- Quotes may also go out by e-mail.
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body)
SELECT event_type, 'email', locale, subject, body
FROM message_template_defaults WHERE channel = 'whatsapp' AND event_type LIKE 'quote.%';

-- Staff-facing todo reminder (all channels).
INSERT INTO message_template_defaults (event_type, channel, locale, subject, body) VALUES
('todo.reminder', 'inapp', 'tr', 'Görev hatırlatması: {{todo_title}}',
 '{{todo_title}} — {{due_in}} ({{due_at}}).'),
('todo.reminder', 'inapp', 'en', 'Task reminder: {{todo_title}}',
 '{{todo_title}} — {{due_in}} ({{due_at}}).'),
('todo.reminder', 'email', 'tr', 'Görev hatırlatması: {{todo_title}}',
 E'Merhaba {{assignee_name}},\n\n"{{todo_title}}" görevi {{due_in}} ({{due_at}}).\n\n{{todo_link}}\n\n{{company_name}}'),
('todo.reminder', 'email', 'en', 'Task reminder: {{todo_title}}',
 E'Hello {{assignee_name}},\n\nThe task "{{todo_title}}" is due {{due_in}} ({{due_at}}).\n\n{{todo_link}}\n\n{{company_name}}'),
('todo.reminder', 'whatsapp', 'tr', 'Görev hatırlatması',
 E'⏰ {{todo_title}}\n{{due_in}} ({{due_at}})\n{{company_name}}'),
('todo.reminder', 'whatsapp', 'en', 'Task reminder',
 E'⏰ {{todo_title}}\nDue {{due_in}} ({{due_at}})\n{{company_name}}'),
('todo.reminder', 'sms', 'tr', 'Görev hatırlatması',
 'Görev: {{todo_title}} - {{due_in}} ({{due_at}})'),
('todo.reminder', 'sms', 'en', 'Task reminder',
 'Task: {{todo_title}} - due {{due_in}} ({{due_at}})');

-- Placeholder rename: {{business_name}} → {{company_name}} is an alias; both render.
-- Drop organization rows that were auto-copied from the old code defaults and
-- never edited, so they follow the system default again.
DELETE FROM message_templates mt
USING message_template_defaults d
WHERE mt.event_type = d.event_type
  AND mt.channel = d.channel
  AND mt.locale = d.locale
  AND mt.subject = d.subject
  AND mt.is_active
  AND replace(mt.body, '{{business_name}}', '{{company_name}}') = d.body;
