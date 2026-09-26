-- End-of-day WhatsApp summary per organization (sent at the business
-- closing time to the selected members).
CREATE TABLE daily_summary_settings (
    organization_id    BIGINT      PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
    enabled            BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Local (Europe/Istanbul) time of day to send, e.g. 20:00.
    send_time          TIME        NOT NULL DEFAULT '20:00',
    recipient_user_ids BIGINT[]    NOT NULL DEFAULT '{}',
    -- Local calendar day of the last summary sent; guards against duplicates.
    last_sent_on       DATE        NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_summary_settings_enabled
    ON daily_summary_settings (enabled)
    WHERE enabled;

CREATE TRIGGER trg_daily_summary_settings_set_updated_at
    BEFORE UPDATE ON daily_summary_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
