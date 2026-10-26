-- APNs (Apple Push Notification service) token key uploaded from the platform
-- admin (Platform → Entegrasyonlar → Apple → Apple Push). Used for iOS Live
-- Activity pushes (modules/livepush); the APNS_* env vars are the fallback.
-- This is a separate key from the Sign in with Apple key stored on
-- oauth_provider_settings (an Apple key is enabled per service).

-- Singleton platform row. private_key_enc is SecretBox ciphertext of the .p8.
CREATE TABLE platform_apns_settings (
    id                  SMALLINT     PRIMARY KEY DEFAULT 1,
    key_id              TEXT         NOT NULL DEFAULT '',
    -- Empty: the Apple integration team id, then APNS_TEAM_ID.
    team_id             TEXT         NOT NULL DEFAULT '',
    bundle_id           TEXT         NOT NULL DEFAULT 'com.otopoly.app',
    environment         TEXT         NOT NULL DEFAULT 'production',
    private_key_enc     TEXT         NULL,
    uploaded_at         TIMESTAMPTZ  NULL,
    -- Last "test connection" result (any source).
    last_test_at        TIMESTAMPTZ  NULL,
    last_test_ok        BOOLEAN      NULL,
    last_test_status    INTEGER      NULL,
    last_test_reason    TEXT         NOT NULL DEFAULT '',
    last_test_verdict   TEXT         NOT NULL DEFAULT '',
    last_test_source    TEXT         NOT NULL DEFAULT '',
    last_test_environment TEXT       NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by          BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT platform_apns_settings_singleton CHECK (id = 1),
    CONSTRAINT chk_platform_apns_settings_environment CHECK (environment IN ('production', 'sandbox'))
);

INSERT INTO platform_apns_settings (id) VALUES (1);

CREATE TRIGGER trg_platform_apns_settings_set_updated_at
    BEFORE UPDATE ON platform_apns_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
