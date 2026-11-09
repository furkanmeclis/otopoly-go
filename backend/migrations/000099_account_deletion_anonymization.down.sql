-- Data-loss note: pending deletions (deletion_scheduled_on) and the
-- anonymized_at marker are dropped. Pending accounts stay disabled
-- (deactivated_at is kept); already anonymized rows stay scrubbed.

DELETE FROM notification_templates
WHERE code IN ('auth.account_deletion_scheduled', 'auth.account_recovery_code', 'auth.account_recovered');

UPDATE notification_templates
SET subject = 'Hesap silme onay kodu: {{code}}',
    body = E'Merhaba {{name}},\n\nHesabınızı silme (pasifleştirme) isteğinizi onaylamak için kodunuz: {{code}}\nKod {{expires_minutes}} dakika geçerlidir.\n\nBu isteği siz yapmadıysanız şifrenizi değiştirmenizi öneririz.'
WHERE code = 'auth.account_deactivation_code' AND channel = 'email' AND language = 'tr';

UPDATE notification_templates
SET subject = 'Account deletion confirmation code: {{code}}',
    body = E'Hello {{name}},\n\nYour code to confirm deleting (deactivating) your account is: {{code}}\nThe code is valid for {{expires_minutes}} minutes.\n\nIf you did not request this, we recommend changing your password.'
WHERE code = 'auth.account_deactivation_code' AND channel = 'email' AND language = 'en';

DELETE FROM otp_codes WHERE type = 'account_recovery';
ALTER TABLE otp_codes DROP CONSTRAINT chk_otp_codes_type;
ALTER TABLE otp_codes ADD CONSTRAINT chk_otp_codes_type CHECK (
    type IN ('password_reset', 'email_verification', 'login_code', 'oauth_link', 'account_deactivation')
);

DROP INDEX IF EXISTS idx_users_deletion_scheduled_on;

ALTER TABLE users
    DROP COLUMN IF EXISTS anonymized_at,
    DROP COLUMN IF EXISTS deletion_previous_status,
    DROP COLUMN IF EXISTS deletion_scheduled_on,
    DROP COLUMN IF EXISTS deletion_requested_at;
