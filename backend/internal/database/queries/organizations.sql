-- name: CreateOrganization :one
INSERT INTO organizations (
    slug, name, city, district, phone, address, status, plan_code,
    access_starts_at, access_ends_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: GetOrganizationByUUID :one
SELECT * FROM organizations
WHERE uuid = $1 AND deleted_at IS NULL;

-- name: GetOrganizationBySlug :one
SELECT * FROM organizations
WHERE slug = $1 AND deleted_at IS NULL;

-- name: GetOrganizationByID :one
SELECT * FROM organizations
WHERE id = $1 AND deleted_at IS NULL;

-- name: SlugExists :one
SELECT EXISTS(
    SELECT 1 FROM organizations WHERE slug = $1 AND deleted_at IS NULL
) AS exists;

-- name: ListOrganizationsFiltered :many
SELECT *
FROM organizations
WHERE deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR slug ILIKE '%' || sqlc.narg(q) || '%'
    OR city ILIKE '%' || sqlc.narg(q) || '%'
    OR phone ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountOrganizations :one
SELECT COUNT(*)::bigint
FROM organizations
WHERE deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
  AND (
    sqlc.narg(q)::text IS NULL
    OR name ILIKE '%' || sqlc.narg(q) || '%'
    OR slug ILIKE '%' || sqlc.narg(q) || '%'
    OR city ILIKE '%' || sqlc.narg(q) || '%'
    OR phone ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: UpdateOrganizationPlatform :one
UPDATE organizations
SET name = COALESCE(sqlc.narg(name), name),
    city = COALESCE(sqlc.narg(city), city),
    district = COALESCE(sqlc.narg(district), district),
    phone = COALESCE(sqlc.narg(phone), phone),
    address = COALESCE(sqlc.narg(address), address),
    status = COALESCE(sqlc.narg(status), status),
    plan_code = COALESCE(sqlc.narg(plan_code), plan_code),
    access_starts_at = COALESCE(sqlc.narg(access_starts_at), access_starts_at),
    access_ends_at = sqlc.narg(access_ends_at)
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: SetOrganizationLogo :one
UPDATE organizations
SET logo_object_key = $2
WHERE uuid = $1 AND deleted_at IS NULL
RETURNING *;

-- name: ClearOrganizationLogo :one
UPDATE organizations
SET logo_object_key = NULL
WHERE uuid = $1 AND deleted_at IS NULL
RETURNING *;

-- name: CreateOrganizationMember :one
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetOrganizationMember :one
SELECT om.*, o.uuid AS organization_uuid, o.slug AS organization_slug
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.organization_id = $1 AND om.user_id = $2;

-- name: GetOrganizationMemberByUserAndSlug :one
SELECT om.*, o.uuid AS organization_uuid, o.slug AS organization_slug, o.status AS organization_status,
       o.access_starts_at, o.access_ends_at, o.name AS organization_name, o.logo_object_key
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = $1 AND o.slug = $2;

-- name: ListOrganizationMembersByUserID :many
SELECT om.role, o.uuid, o.slug, o.name, o.logo_object_key, o.status, o.access_ends_at
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = $1
ORDER BY o.name ASC;

-- name: ListOrganizationMembers :many
SELECT u.uuid, u.email, u.name, u.surname, u.status, om.role, om.created_at
FROM organization_members om
JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = $1
ORDER BY om.created_at ASC;
