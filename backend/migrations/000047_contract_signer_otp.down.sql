DROP TABLE IF EXISTS contract_signer_otps;

ALTER TABLE contract_signers
    DROP COLUMN IF EXISTS otp_phone,
    DROP COLUMN IF EXISTS otp_channel,
    DROP COLUMN IF EXISTS otp_verified_at,
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS suggested_name;

ALTER TABLE contract_instances DROP COLUMN IF EXISTS otp_required;
ALTER TABLE contract_templates DROP COLUMN IF EXISTS otp_required;
ALTER TABLE contract_presets DROP COLUMN IF EXISTS otp_required;
