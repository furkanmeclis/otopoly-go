-- Platform APNs key (singleton, Live Activity pushes). Not organization-owned.

-- name: GetPlatformAPNsSettings :one
SELECT * FROM platform_apns_settings WHERE id = 1;

-- name: SavePlatformAPNsSettings :one
-- A NULL private_key_enc keeps the stored key; a new key stamps uploaded_at.
-- Any change clears the last test result (it no longer describes this key).
UPDATE platform_apns_settings
SET key_id = sqlc.arg(key_id),
    team_id = sqlc.arg(team_id),
    bundle_id = sqlc.arg(bundle_id),
    environment = sqlc.arg(environment),
    private_key_enc = COALESCE(sqlc.narg(private_key_enc), private_key_enc),
    uploaded_at = CASE WHEN sqlc.narg(private_key_enc)::text IS NULL THEN uploaded_at ELSE NOW() END,
    last_test_at = NULL,
    last_test_ok = NULL,
    last_test_status = NULL,
    last_test_reason = '',
    last_test_verdict = '',
    last_test_source = '',
    last_test_environment = '',
    updated_by = sqlc.narg(updated_by)
WHERE id = 1
RETURNING *;

-- name: ClearPlatformAPNsSettings :one
UPDATE platform_apns_settings
SET key_id = '',
    team_id = '',
    bundle_id = 'com.otopoly.app',
    environment = 'production',
    private_key_enc = NULL,
    uploaded_at = NULL,
    last_test_at = NULL,
    last_test_ok = NULL,
    last_test_status = NULL,
    last_test_reason = '',
    last_test_verdict = '',
    last_test_source = '',
    last_test_environment = '',
    updated_by = sqlc.narg(updated_by)
WHERE id = 1
RETURNING *;

-- name: RecordPlatformAPNsTest :one
UPDATE platform_apns_settings
SET last_test_at = NOW(),
    last_test_ok = sqlc.arg(last_test_ok),
    last_test_status = sqlc.narg(last_test_status),
    last_test_reason = sqlc.arg(last_test_reason),
    last_test_verdict = sqlc.arg(last_test_verdict),
    last_test_source = sqlc.arg(last_test_source),
    last_test_environment = sqlc.arg(last_test_environment)
WHERE id = 1
RETURNING *;
