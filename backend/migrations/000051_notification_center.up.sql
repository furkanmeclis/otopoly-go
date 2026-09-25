-- Central notification system: scheduled/dispatched notifications, per-type
-- user preferences, member contact settings and queued outbound messages.

-- One row per (recipient, notification, fire slot). Both immediate dispatches
-- and future reminders live here so the dedupe key covers retries and
-- concurrent workers.
--   status: pending → processing → sent | failed ; pending → cancelled
--   channels: empty = resolve at send time (user preferences / org rules)
--   delivered_channels: channels already handed off (skipped on retry)
CREATE TABLE scheduled_notifications (
    id                    BIGSERIAL    PRIMARY KEY,
    uuid                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id       BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    kind                  VARCHAR(64)  NOT NULL,
    subject_type          VARCHAR(32)  NOT NULL,
    -- Polymorphic subject (todo, quote, lead, ...): no FK by design.
    subject_id            BIGINT       NOT NULL,
    recipient_user_id     BIGINT       REFERENCES users (id) ON DELETE CASCADE,
    recipient_customer_id BIGINT       REFERENCES customers (id) ON DELETE CASCADE,
    recipient_phone       VARCHAR(32)  NOT NULL DEFAULT '',
    recipient_email       VARCHAR(255) NOT NULL DEFAULT '',
    channels              TEXT[]       NOT NULL DEFAULT '{}',
    delivered_channels    TEXT[]       NOT NULL DEFAULT '{}',
    locale                VARCHAR(8)   NOT NULL DEFAULT '',
    vars                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    attachment            JSONB,
    action_url            TEXT         NOT NULL DEFAULT '',
    fire_at               TIMESTAMPTZ  NOT NULL,
    next_attempt_at       TIMESTAMPTZ  NOT NULL,
    status                VARCHAR(16)  NOT NULL DEFAULT 'pending',
    attempts              INTEGER      NOT NULL DEFAULT 0,
    max_attempts          INTEGER      NOT NULL DEFAULT 5,
    last_error            TEXT         NOT NULL DEFAULT '',
    dedupe_key            VARCHAR(255) NOT NULL,
    locked_at             TIMESTAMPTZ,
    sent_at               TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    created_by            BIGINT       REFERENCES users (id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_scheduled_notifications_uuid UNIQUE (uuid),
    CONSTRAINT uq_scheduled_notifications_dedupe UNIQUE (organization_id, dedupe_key),
    CONSTRAINT chk_scheduled_notifications_status CHECK (
        status IN ('pending', 'processing', 'sent', 'cancelled', 'failed')
    ),
    CONSTRAINT chk_scheduled_notifications_attempts CHECK (attempts >= 0 AND max_attempts >= 1),
    CONSTRAINT chk_scheduled_notifications_recipient CHECK (
        recipient_user_id IS NOT NULL OR recipient_customer_id IS NOT NULL
        OR recipient_phone <> '' OR recipient_email <> ''
    )
);

-- Scheduler claim path: pending rows by due time.
CREATE INDEX idx_scheduled_notifications_status_fire
    ON scheduled_notifications (status, next_attempt_at);
-- Stuck-processing reclaim.
CREATE INDEX idx_scheduled_notifications_processing
    ON scheduled_notifications (locked_at)
    WHERE status = 'processing';
-- CancelBySubject / subject lookups.
CREATE INDEX idx_scheduled_notifications_subject
    ON scheduled_notifications (organization_id, subject_type, subject_id);

CREATE TRIGGER trg_scheduled_notifications_updated_at
    BEFORE UPDATE ON scheduled_notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per user, per organization, per notification type channel switches.
-- Missing rows fall back to code defaults (in-app on, WhatsApp on when a phone is set).
CREATE TABLE notification_type_preferences (
    id                BIGSERIAL   PRIMARY KEY,
    user_id           BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id   BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    notification_type VARCHAR(64) NOT NULL,
    inapp_enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    email_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    whatsapp_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
    sms_enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_type_preferences UNIQUE (user_id, organization_id, notification_type)
);

CREATE INDEX idx_notification_type_preferences_org
    ON notification_type_preferences (organization_id);

CREATE TRIGGER trg_notification_type_preferences_updated_at
    BEFORE UPDATE ON notification_type_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Member contact data used by the notification center (users have no phone).
CREATE TABLE notification_member_settings (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    phone           VARCHAR(32) NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_member_settings UNIQUE (user_id, organization_id)
);

CREATE TRIGGER trg_notification_member_settings_updated_at
    BEFORE UPDATE ON notification_member_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Queued WhatsApp/SMS sends: the worker persists the rendered body and the
-- API process (which owns the WhatsApp sessions) delivers it.
ALTER TABLE outbound_messages
    ADD COLUMN body                      TEXT    NOT NULL DEFAULT '',
    ADD COLUMN attachment                JSONB,
    ADD COLUMN attempts                  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN scheduled_notification_id BIGINT  REFERENCES scheduled_notifications (id) ON DELETE SET NULL;

CREATE INDEX idx_outbound_messages_scheduled
    ON outbound_messages (scheduled_notification_id)
    WHERE scheduled_notification_id IS NOT NULL;
