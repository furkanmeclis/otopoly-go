-- Platform whatsmeow number pairing: the QR code is polled by the platform
-- panel like org sessions poll whatsapp_sessions.qr_code.
ALTER TABLE platform_whatsapp_settings
    ADD COLUMN wm_qr_code       TEXT        NOT NULL DEFAULT '',
    ADD COLUMN wm_qr_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN wm_error         TEXT        NOT NULL DEFAULT '';
