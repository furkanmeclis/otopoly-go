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
-- Re-activating a user (status -> active) clears a self-service deactivation.
UPDATE users
SET name = COALESCE(sqlc.narg(name), name),
    surname = COALESCE(sqlc.narg(surname), surname),
    status = COALESCE(sqlc.narg(status), status),
    deactivated_at = CASE WHEN sqlc.narg(status)::text = 'active' THEN NULL ELSE deactivated_at END
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

-- name: DeactivateUser :one
-- Self-service account deletion: keep every row, mark the user disabled.
UPDATE users
SET status = 'disabled',
    deactivated_at = COALESCE(deactivated_at, NOW())
WHERE id = $1 AND deleted_at IS NULL
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
UPDATE users
SET deleted_at = NULL
WHERE id = $1 AND deleted_at IS NOT NULL
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
