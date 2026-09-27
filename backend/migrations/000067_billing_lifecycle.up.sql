CREATE TABLE billing_reminder_log (
    id              BIGSERIAL     PRIMARY KEY,
    key             VARCHAR(120)  NOT NULL,
    kind            VARCHAR(40)   NOT NULL,
    organization_id BIGINT        NULL REFERENCES organizations (id) ON DELETE CASCADE,
    sent_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_reminder_log_key UNIQUE (key)
);

CREATE INDEX idx_billing_reminder_log_org_sent
    ON billing_reminder_log (organization_id, sent_at DESC);
