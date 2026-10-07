-- name: InsertActivityEvent :one
INSERT INTO activity_events (actor_user_id, action, resource, resource_uuid, payload, ip_address, user_agent, organization_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListActivityEvents :many
SELECT * FROM activity_events
WHERE (sqlc.narg(actor_user_id)::bigint IS NULL OR actor_user_id = sqlc.narg(actor_user_id))
  AND (sqlc.narg(resource)::text IS NULL OR resource = sqlc.narg(resource))
  AND (sqlc.narg(action)::text IS NULL OR action = sqlc.narg(action))
  AND (
    sqlc.narg(q)::text IS NULL
    OR action ILIKE '%' || sqlc.narg(q) || '%'
    OR resource ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY created_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountActivityEvents :one
SELECT COUNT(*)::bigint FROM activity_events
WHERE (sqlc.narg(actor_user_id)::bigint IS NULL OR actor_user_id = sqlc.narg(actor_user_id))
  AND (sqlc.narg(resource)::text IS NULL OR resource = sqlc.narg(resource))
  AND (sqlc.narg(action)::text IS NULL OR action = sqlc.narg(action))
  AND (
    sqlc.narg(q)::text IS NULL
    OR action ILIKE '%' || sqlc.narg(q) || '%'
    OR resource ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: ListActivityEventsForOrganization :many
SELECT a.uuid, a.action, a.resource, a.resource_uuid, a.payload, a.created_at,
       u.uuid AS actor_uuid, u.email AS actor_email, u.name AS actor_name, u.surname AS actor_surname
FROM activity_events a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(action)::text IS NULL OR a.action = sqlc.narg(action))
  AND (
    sqlc.narg(q)::text IS NULL
    OR a.action ILIKE '%' || sqlc.narg(q) || '%'
    OR a.resource ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountActivityEventsForOrganization :one
SELECT COUNT(*)::bigint FROM activity_events a
WHERE a.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(action)::text IS NULL OR a.action = sqlc.narg(action))
  AND (
    sqlc.narg(q)::text IS NULL
    OR a.action ILIKE '%' || sqlc.narg(q) || '%'
    OR a.resource ILIKE '%' || sqlc.narg(q) || '%'
  );
