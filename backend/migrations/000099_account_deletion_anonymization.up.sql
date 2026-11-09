-- Self-service account deletion with a 30-day recovery window, followed by
-- anonymization. Nothing is hard-deleted from users: the row is scrubbed so
-- business records (jobs, sales, finance, audit) keep their references.
--
--   deletion_requested_at    when the user confirmed the deletion
--   deletion_scheduled_on    Europe/Istanbul business day on which the
--                            anonymization job scrubs the account
--   deletion_previous_status status to restore when the user recovers
--   anonymized_at            set once personal data was scrubbed (final)
--
-- A pending account also has status = 'disabled' and deactivated_at set, so
-- every sign-in path keeps answering ACCOUNT_DEACTIVATED.

ALTER TABLE users
    ADD COLUMN deletion_requested_at    TIMESTAMPTZ NULL,
    ADD COLUMN deletion_scheduled_on    DATE        NULL,
    ADD COLUMN deletion_previous_status VARCHAR(32) NULL,
    ADD COLUMN anonymized_at            TIMESTAMPTZ NULL;

CREATE INDEX idx_users_deletion_scheduled_on
    ON users (deletion_scheduled_on)
    WHERE deletion_scheduled_on IS NOT NULL AND anonymized_at IS NULL;

ALTER TABLE otp_codes DROP CONSTRAINT chk_otp_codes_type;
ALTER TABLE otp_codes ADD CONSTRAINT chk_otp_codes_type CHECK (
    type IN ('password_reset', 'email_verification', 'login_code', 'oauth_link', 'account_deactivation', 'account_recovery')
);

-- The deletion confirmation code now starts a 30-day recoverable deletion.
UPDATE notification_templates
SET subject = 'Hesap silme onay kodu: {{code}}',
    body = E'Merhaba {{name}},\n\nHesabınızı silme isteğinizi onaylamak için kodunuz: {{code}}\nKod {{expires_minutes}} dakika geçerlidir ve yalnızca bir kez kullanılabilir.\n\nOnayladığınızda hesabınız hemen devre dışı kalır ve giriş yapılamaz. 30 gün içinde kurtarmazsanız hesabınız kalıcı olarak anonimleştirilir.\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın; hesabınızda bir değişiklik olmaz.'
WHERE code = 'auth.account_deactivation_code' AND channel = 'email' AND language = 'tr';

UPDATE notification_templates
SET subject = 'Account deletion confirmation code: {{code}}',
    body = E'Hello {{name}},\n\nYour code to confirm deleting your account is: {{code}}\nThe code is valid for {{expires_minutes}} minutes and can be used once.\n\nOnce you confirm, your account is disabled right away and nobody can sign in to it. If you do not recover it within 30 days, your account is permanently anonymized.\n\nIf you did not request this, ignore this email; nothing will change.'
WHERE code = 'auth.account_deactivation_code' AND channel = 'email' AND language = 'en';

INSERT INTO notification_templates (code, channel, language, subject, body, active) VALUES
    ('auth.account_deletion_scheduled', 'email', 'tr', 'Hesabınız silinmek üzere devre dışı bırakıldı',
     E'Merhaba {{name}},\n\nHesap silme isteğiniz onaylandı. Hesabınız şu anda devre dışı, tüm oturumlarınız kapatıldı ve giriş yapılamaz.\n\n{{deletion_date}} tarihinde kişisel verileriniz (ad, e-posta, giriş yöntemleri, cihazlar) kalıcı olarak anonimleştirilecek. İşletme kayıtları yasal yükümlülükler gereği saklanır ancak artık sizinle ilişkilendirilmez.\n\nFikrinizi değiştirirseniz bu tarihe kadar hesabınızı buradan kurtarabilirsiniz:\n{{recover_url}}\n\nBu işlemi siz yapmadıysanız hemen yukarıdaki bağlantıdan hesabınızı kurtarın ve destek ekibiyle iletişime geçin.', TRUE),
    ('auth.account_deletion_scheduled', 'email', 'en', 'Your account is disabled and scheduled for deletion',
     E'Hello {{name}},\n\nYour account deletion request was confirmed. Your account is now disabled, every session was signed out and nobody can sign in to it.\n\nOn {{deletion_date}} your personal data (name, email, sign-in methods, devices) will be permanently anonymized. Business records are kept where the law requires it, but they will no longer be linked to you.\n\nIf you change your mind, you can recover your account until then here:\n{{recover_url}}\n\nIf you did not do this, recover your account right away using the link above and contact support.', TRUE),
    ('auth.account_recovery_code', 'email', 'tr', 'Hesap kurtarma kodu: {{code}}',
     E'Merhaba {{name}},\n\nHesap silme işlemini iptal edip hesabınızı kurtarmak için kodunuz: {{code}}\nKod {{expires_minutes}} dakika geçerlidir ve yalnızca bir kez kullanılabilir.\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın.', TRUE),
    ('auth.account_recovery_code', 'email', 'en', 'Account recovery code: {{code}}',
     E'Hello {{name}},\n\nYour code to cancel the deletion and recover your account is: {{code}}\nThe code is valid for {{expires_minutes}} minutes and can be used once.\n\nIf you did not request this, ignore this email.', TRUE),
    ('auth.account_recovered', 'email', 'tr', 'Hesabınız kurtarıldı',
     E'Merhaba {{name}},\n\nHesap silme işlemi iptal edildi ve hesabınız yeniden etkinleştirildi. Artık her zamanki yöntemlerinizle giriş yapabilirsiniz.\n\nBu işlemi siz yapmadıysanız lütfen destek ekibiyle iletişime geçin.', TRUE),
    ('auth.account_recovered', 'email', 'en', 'Your account was recovered',
     E'Hello {{name}},\n\nThe account deletion was cancelled and your account is active again. You can sign in with your usual methods.\n\nIf you did not do this, please contact support.', TRUE)
ON CONFLICT (code, channel, language) DO NOTHING;
