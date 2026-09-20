ALTER TABLE whatsapp_sessions
    DROP COLUMN IF EXISTS qr_expires_at,
    DROP COLUMN IF EXISTS qr_code;
