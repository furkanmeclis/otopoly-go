-- Team vehicle alerts: in-app/push instantly, WhatsApp (to members without
-- web push) instantly or batched, filtered by event and service.
CREATE TABLE vehicle_alert_settings (
    organization_id    BIGINT      PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
    enabled            BOOLEAN     NOT NULL DEFAULT FALSE,
    events             TEXT[]      NOT NULL DEFAULT '{created,delivered,cancelled}',
    -- Empty = every service.
    service_ids        BIGINT[]    NOT NULL DEFAULT '{}',
    recipient_user_ids BIGINT[]    NOT NULL DEFAULT '{}',
    -- 0 = instant (next minute sweep), otherwise one WhatsApp digest per window.
    batch_minutes      INTEGER     NOT NULL DEFAULT 0,
    last_flushed_at    TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vehicle_alert_settings_batch CHECK (batch_minutes IN (0, 30, 60))
);

CREATE TRIGGER trg_vehicle_alert_settings_set_updated_at
    BEFORE UPDATE ON vehicle_alert_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Pending WhatsApp lines; sent_at is set when delivered in a message.
CREATE TABLE vehicle_alert_events (
    id              BIGSERIAL      PRIMARY KEY,
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    job_id          BIGINT         NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    event           VARCHAR(16)    NOT NULL,
    line            TEXT           NOT NULL,
    amount          NUMERIC(18, 2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ    NULL
);

CREATE INDEX idx_vehicle_alert_events_pending
    ON vehicle_alert_events (organization_id, created_at)
    WHERE sent_at IS NULL;
