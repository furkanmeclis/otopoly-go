-- Review collection (değerlendirme toplama): per-organization settings and one
-- review request per delivered job (or a test send). The request is scheduled
-- after delivery, sent over WhatsApp / SMS with a public short link
-- (/r/{token}), answered with 1-5 stars and an optional comment; low scores
-- need a follow-up by the business.

CREATE TABLE review_settings (
    organization_id       BIGINT       PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
    enabled               BOOLEAN      NOT NULL DEFAULT FALSE,
    -- auto = WhatsApp when it can send now, else SMS.
    channel               VARCHAR(16)  NOT NULL DEFAULT 'auto',
    delay_minutes         INTEGER      NOT NULL DEFAULT 120,
    quiet_hours_enabled   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Hours (Europe/Istanbul): no sends from quiet_start until quiet_end.
    quiet_start_hour      SMALLINT     NOT NULL DEFAULT 21,
    quiet_end_hour        SMALLINT     NOT NULL DEFAULT 9,
    google_review_url     VARCHAR(500) NOT NULL DEFAULT '',
    high_score_threshold  SMALLINT     NOT NULL DEFAULT 4,
    min_days_between      INTEGER      NOT NULL DEFAULT 30,
    consent_text          TEXT         NOT NULL DEFAULT '',
    default_locale        VARCHAR(8)   NOT NULL DEFAULT 'tr',
    excluded_customer_ids BIGINT[]     NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_review_settings_channel CHECK (channel IN ('auto', 'sms', 'whatsapp')),
    CONSTRAINT chk_review_settings_delay CHECK (delay_minutes BETWEEN 30 AND 2880),
    CONSTRAINT chk_review_settings_quiet CHECK (quiet_start_hour BETWEEN 0 AND 23 AND quiet_end_hour BETWEEN 0 AND 23),
    CONSTRAINT chk_review_settings_threshold CHECK (high_score_threshold BETWEEN 2 AND 5),
    CONSTRAINT chk_review_settings_min_days CHECK (min_days_between BETWEEN 0 AND 365),
    CONSTRAINT chk_review_settings_locale CHECK (default_locale IN ('tr', 'en'))
);

CREATE TRIGGER trg_review_settings_set_updated_at
    BEFORE UPDATE ON review_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE review_requests (
    id                    BIGSERIAL    PRIMARY KEY,
    uuid                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id       BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    kind                  VARCHAR(8)   NOT NULL DEFAULT 'job',
    job_id                BIGINT       NULL REFERENCES service_jobs (id) ON DELETE SET NULL,
    customer_id           BIGINT       NULL REFERENCES customers (id) ON DELETE SET NULL,
    customer_name         VARCHAR(150) NOT NULL DEFAULT '',
    recipient_phone       VARCHAR(32)  NOT NULL DEFAULT '',
    plate                 VARCHAR(16)  NOT NULL DEFAULT '',
    token                 VARCHAR(64)  NOT NULL,
    status                VARCHAR(16)  NOT NULL DEFAULT 'scheduled',
    skip_reason           VARCHAR(48)  NOT NULL DEFAULT '',
    error                 TEXT         NOT NULL DEFAULT '',
    channel               VARCHAR(16)  NOT NULL DEFAULT '',
    locale                VARCHAR(8)   NOT NULL DEFAULT 'tr',
    send_at               TIMESTAMPTZ  NOT NULL,
    deferred              BOOLEAN      NOT NULL DEFAULT FALSE,
    sent_at               TIMESTAMPTZ  NULL,
    opened_at             TIMESTAMPTZ  NULL,
    answered_at           TIMESTAMPTZ  NULL,
    expires_at            TIMESTAMPTZ  NULL,
    cancelled_at          TIMESTAMPTZ  NULL,
    outbound_message_uuid UUID         NULL,
    view_count            INTEGER      NOT NULL DEFAULT 0,
    score                 SMALLINT     NULL,
    comment               TEXT         NOT NULL DEFAULT '',
    consent               BOOLEAN      NOT NULL DEFAULT FALSE,
    is_high               BOOLEAN      NULL,
    answer_ip             VARCHAR(64)  NOT NULL DEFAULT '',
    answer_user_agent     VARCHAR(400) NOT NULL DEFAULT '',
    google_redirects      INTEGER      NOT NULL DEFAULT 0,
    google_redirected_at  TIMESTAMPTZ  NULL,
    follow_up_status      VARCHAR(16)  NOT NULL DEFAULT 'none',
    follow_up_note        TEXT         NOT NULL DEFAULT '',
    followed_up_at        TIMESTAMPTZ  NULL,
    followed_up_by        BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_by            BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_review_requests_uuid UNIQUE (uuid),
    CONSTRAINT uq_review_requests_token UNIQUE (token),
    CONSTRAINT chk_review_requests_kind CHECK (kind IN ('job', 'test')),
    CONSTRAINT chk_review_requests_status CHECK (status IN (
        'scheduled', 'sending', 'sent', 'opened', 'answered', 'expired', 'cancelled', 'skipped', 'failed'
    )),
    CONSTRAINT chk_review_requests_channel CHECK (channel IN ('', 'sms', 'whatsapp')),
    CONSTRAINT chk_review_requests_locale CHECK (locale IN ('tr', 'en')),
    CONSTRAINT chk_review_requests_score CHECK (score IS NULL OR score BETWEEN 1 AND 5),
    CONSTRAINT chk_review_requests_follow_up CHECK (follow_up_status IN ('none', 'required', 'done'))
);

-- One request per delivered job (idempotent scheduling).
CREATE UNIQUE INDEX uq_review_requests_org_job
    ON review_requests (organization_id, job_id)
    WHERE kind = 'job' AND job_id IS NOT NULL;

CREATE INDEX idx_review_requests_due
    ON review_requests (send_at)
    WHERE status = 'scheduled';

CREATE INDEX idx_review_requests_open
    ON review_requests (expires_at)
    WHERE status IN ('sent', 'opened');

CREATE INDEX idx_review_requests_org_created
    ON review_requests (organization_id, created_at DESC);

CREATE INDEX idx_review_requests_org_customer
    ON review_requests (organization_id, customer_id, sent_at DESC);

CREATE INDEX idx_review_requests_org_follow_up
    ON review_requests (organization_id, answered_at DESC)
    WHERE follow_up_status = 'required';

CREATE TRIGGER trg_review_requests_set_updated_at
    BEFORE UPDATE ON review_requests
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
