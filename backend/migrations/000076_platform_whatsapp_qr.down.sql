ALTER TABLE platform_whatsapp_settings
    DROP COLUMN IF EXISTS wm_qr_code,
    DROP COLUMN IF EXISTS wm_qr_expires_at,
    DROP COLUMN IF EXISTS wm_error;
