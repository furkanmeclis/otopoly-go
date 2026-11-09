-- name: CreateUser :one
INSERT INTO users (email, password_hash, name, surname, status, email_verified_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetUserByUUID :one
SELECT * FROM users
WHERE uuid = $1 AND deleted_at IS NULL;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 AND deleted_at IS NULL;

-- name: UpdateUserLastLogin :exec
UPDATE users
SET last_login_at = NOW()
WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateUserPasswordByID :exec
UPDATE users
SET password_hash = $2,
    password_set = TRUE
WHERE id = $1 AND deleted_at IS NULL;

-- name: MarkUserPasswordUnset :exec
-- OAuth sign-up stores a random hash; the user never chose a password.
UPDATE users
SET password_set = FALSE
WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateUserProfileBasics :exec
UPDATE users
SET name = $2,
    surname = $3,
    status = $4,
    email_verified_at = COALESCE(email_verified_at, NOW())
WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateUserPlatform :one
-- Re-activating a user (status -> active) clears a self-service deactivation
-- and cancels a pending deletion.
UPDATE users
SET name = COALESCE(sqlc.narg(name), name),
    surname = COALESCE(sqlc.narg(surname), surname),
    status = COALESCE(sqlc.narg(status), status),
    deactivated_at = CASE WHEN sqlc.narg(status)::text = 'active' THEN NULL ELSE deactivated_at END,
    deletion_requested_at = CASE WHEN sqlc.narg(status)::text = 'active' THEN NULL ELSE deletion_requested_at END,
    deletion_scheduled_on = CASE WHEN sqlc.narg(status)::text = 'active' THEN NULL ELSE deletion_scheduled_on END,
    deletion_previous_status = CASE WHEN sqlc.narg(status)::text = 'active' THEN NULL ELSE deletion_previous_status END
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: UpdateUserProfileByUUID :one
UPDATE users
SET name = COALESCE(sqlc.narg(name), name),
    surname = COALESCE(sqlc.narg(surname), surname),
    locale = COALESCE(sqlc.narg(locale), locale)
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: UpdateUserLocale :exec
UPDATE users
SET locale = $2
WHERE id = $1 AND deleted_at IS NULL;

-- name: ListUsersFiltered :many
SELECT DISTINCT u.*
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE (CASE WHEN sqlc.arg(only_deleted)::boolean THEN u.deleted_at IS NOT NULL ELSE u.deleted_at IS NULL END)
  AND (sqlc.narg(status)::text IS NULL OR u.status = sqlc.narg(status))
  AND (sqlc.narg(role_slug)::text IS NULL OR r.slug = sqlc.narg(role_slug))
  AND (
    sqlc.narg(q)::text IS NULL
    OR u.email ILIKE '%' || sqlc.narg(q) || '%'
    OR u.name ILIKE '%' || sqlc.narg(q) || '%'
    OR u.surname ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY u.deleted_at DESC NULLS LAST, u.created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountUsers :one
SELECT COUNT(DISTINCT u.id)::bigint
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE (CASE WHEN sqlc.arg(only_deleted)::boolean THEN u.deleted_at IS NOT NULL ELSE u.deleted_at IS NULL END)
  AND (sqlc.narg(status)::text IS NULL OR u.status = sqlc.narg(status))
  AND (sqlc.narg(role_slug)::text IS NULL OR r.slug = sqlc.narg(role_slug))
  AND (
    sqlc.narg(q)::text IS NULL
    OR u.email ILIKE '%' || sqlc.narg(q) || '%'
    OR u.name ILIKE '%' || sqlc.narg(q) || '%'
    OR u.surname ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: CountUsersWithRole :one
SELECT COUNT(DISTINCT u.id)::bigint
FROM users u
INNER JOIN user_roles ur ON ur.user_id = u.id
INNER JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
  AND u.status <> 'disabled'
  AND r.slug = sqlc.arg(role_slug);

-- name: ListUsersForExport :many
SELECT DISTINCT u.*
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR u.status = sqlc.narg(status))
  AND (sqlc.narg(role_slug)::text IS NULL OR r.slug = sqlc.narg(role_slug))
  AND (
    sqlc.narg(q)::text IS NULL
    OR u.email ILIKE '%' || sqlc.narg(q) || '%'
    OR u.name ILIKE '%' || sqlc.narg(q) || '%'
    OR u.surname ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY u.created_at DESC;

-- name: ListUserUUIDsForBulk :many
SELECT DISTINCT u.uuid
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR u.status = sqlc.narg(status))
  AND (sqlc.narg(role_slug)::text IS NULL OR r.slug = sqlc.narg(role_slug))
  AND (
    sqlc.narg(q)::text IS NULL
    OR u.email ILIKE '%' || sqlc.narg(q) || '%'
    OR u.name ILIKE '%' || sqlc.narg(q) || '%'
    OR u.surname ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY u.created_at DESC;

-- name: ScheduleUserDeletion :one
-- Self-service account deletion: the account is disabled at once and the
-- anonymization job scrubs it on deletion_scheduled_on (Istanbul day).
-- deletion_previous_status remembers what recovery restores; a legacy
-- self-deactivated account (deactivated_at, no schedule) was active before.
UPDATE users
SET deletion_previous_status = CASE WHEN deactivated_at IS NOT NULL THEN 'active' ELSE status END,
    status = 'disabled',
    deactivated_at = COALESCE(deactivated_at, NOW()),
    deletion_requested_at = NOW(),
    deletion_scheduled_on = sqlc.arg(scheduled_on)::date
WHERE id = sqlc.arg(id)
  AND deleted_at IS NULL
  AND anonymized_at IS NULL
  AND deletion_scheduled_on IS NULL
RETURNING *;

-- name: CancelUserDeletion :one
-- Recovery inside the grace period: restore the previous status.
UPDATE users
SET status = COALESCE(deletion_previous_status, 'active'),
    deactivated_at = NULL,
    deletion_requested_at = NULL,
    deletion_scheduled_on = NULL,
    deletion_previous_status = NULL
WHERE id = $1
  AND deleted_at IS NULL
  AND anonymized_at IS NULL
  AND deletion_scheduled_on IS NOT NULL
RETURNING *;

-- name: ListUsersDueForAnonymization :many
-- Pending deletions whose day has come. Soft-deleted users are included: a
-- platform delete during the grace period must not skip the scrub.
SELECT id FROM users
WHERE deletion_scheduled_on IS NOT NULL
  AND deletion_scheduled_on <= sqlc.arg(today)::date
  AND anonymized_at IS NULL
ORDER BY deletion_scheduled_on ASC, id ASC
LIMIT sqlc.arg(limit_count);

-- name: GetUserForAnonymization :one
-- Locks a due user for the scrub transaction (also when soft-deleted).
SELECT * FROM users
WHERE id = $1
  AND deletion_scheduled_on IS NOT NULL
  AND anonymized_at IS NULL
FOR UPDATE;

-- name: AnonymizeUser :one
-- Scrubs personal data on the users row and keeps the row for references.
UPDATE users
SET email = sqlc.arg(email),
    password_hash = sqlc.arg(password_hash),
    password_set = FALSE,
    name = sqlc.arg(name),
    surname = sqlc.arg(surname),
    status = 'disabled',
    email_verified_at = NULL,
    last_login_at = NULL,
    deactivated_at = COALESCE(deactivated_at, NOW()),
    deleted_at = COALESCE(deleted_at, NOW()),
    deletion_previous_status = NULL,
    anonymized_at = NOW()
WHERE id = sqlc.arg(id) AND anonymized_at IS NULL
RETURNING *;

-- name: GetUserByUUIDIncludingDeleted :one
-- Platform admin detail / restore: also returns soft-deleted users.
SELECT * FROM users
WHERE uuid = $1;

-- name: SoftDeleteUser :one
-- Platform admin deletion. The partial unique index on email
-- (WHERE deleted_at IS NULL) frees the address for a new account.
UPDATE users
SET deleted_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: RestoreUser :one
-- Anonymized accounts are final and cannot be restored.
UPDATE users
SET deleted_at = NULL
WHERE id = $1 AND deleted_at IS NOT NULL AND anonymized_at IS NULL
RETURNING *;

-- name: ListSoleOwnedOrganizationsByUserID :many
-- Organizations where the user is the only owner left (ignoring deleted users).
SELECT o.uuid, o.slug, o.name
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = $1
  AND om.role = 'owner'
  AND NOT EXISTS (
    SELECT 1
    FROM organization_members other
    JOIN users ou ON ou.id = other.user_id AND ou.deleted_at IS NULL
    WHERE other.organization_id = om.organization_id
      AND other.role = 'owner'
      AND other.user_id <> om.user_id
  )
ORDER BY o.name ASC;
