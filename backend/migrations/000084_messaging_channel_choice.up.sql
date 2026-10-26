-- Staff messages (daily summary, vehicle alerts) may go out by SMS through
-- the organization's active SMS provider instead of WhatsApp.
ALTER TABLE daily_summary_settings
    ADD COLUMN channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp',
    ADD CONSTRAINT chk_daily_summary_settings_channel CHECK (channel IN ('whatsapp', 'sms'));

ALTER TABLE vehicle_alert_settings
    ADD COLUMN channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp',
    ADD CONSTRAINT chk_vehicle_alert_settings_channel CHECK (channel IN ('whatsapp', 'sms'));
