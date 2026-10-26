-- Live Activities (iOS ActivityKit) / Live Updates (Android) and Home Screen
-- widgets kept fresh while the app is closed (mobile docs/LIVE_WIDGETS.md).

-- One row per running job activity on one device. iOS rows carry the
-- per-activity APNs push token (ActivityKit, rotates); Android rows carry the
-- Expo push token of the device, which receives a data-only message and
-- re-posts the Live Update notification. Rows expire with the activity
-- (ActivityKit ends an activity after at most 12 hours).
CREATE TABLE live_activity_tokens (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    job_id          BIGINT       NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    platform        VARCHAR(16)  NOT NULL,
    activity_id     VARCHAR(128) NOT NULL,
    push_token      VARCHAR(255) NOT NULL DEFAULT '',
    device_token    VARCHAR(255) NOT NULL DEFAULT '',
    locale          VARCHAR(8)   NOT NULL DEFAULT '',
    last_status     VARCHAR(32)  NOT NULL DEFAULT '',
    last_hash       VARCHAR(64)  NOT NULL DEFAULT '',
    last_sent_at    TIMESTAMPTZ  NULL,
    expires_at      TIMESTAMPTZ  NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_live_activity_tokens_uuid UNIQUE (uuid),
    CONSTRAINT uq_live_activity_tokens_activity UNIQUE (user_id, platform, activity_id, device_token),
    CONSTRAINT chk_live_activity_tokens_platform CHECK (platform IN ('ios', 'android')),
    CONSTRAINT chk_live_activity_tokens_target CHECK (
        (platform = 'ios' AND push_token <> '') OR (platform = 'android' AND device_token <> '')
    )
);

CREATE INDEX idx_live_activity_tokens_org_job ON live_activity_tokens (organization_id, job_id);
CREATE INDEX idx_live_activity_tokens_expires_at ON live_activity_tokens (expires_at);

CREATE TRIGGER trg_live_activity_tokens_set_updated_at BEFORE UPDATE ON live_activity_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which organization a device's widgets show (the app's active organization),
-- plus the ActivityKit push-to-start token (iOS 17.2+). One row per push
-- device; switching organization moves the row. Signing out deletes the push
-- device and with it this row.
CREATE TABLE live_activity_devices (
    id                  BIGSERIAL    PRIMARY KEY,
    organization_id     BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id             BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    push_device_id      BIGINT       NOT NULL REFERENCES push_devices (id) ON DELETE CASCADE,
    push_to_start_token VARCHAR(255) NOT NULL DEFAULT '',
    widgets_enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_widget_push_at TIMESTAMPTZ  NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_live_activity_devices_push_device UNIQUE (push_device_id)
);

CREATE INDEX idx_live_activity_devices_org ON live_activity_devices (organization_id) WHERE widgets_enabled;

CREATE TRIGGER trg_live_activity_devices_set_updated_at BEFORE UPDATE ON live_activity_devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
