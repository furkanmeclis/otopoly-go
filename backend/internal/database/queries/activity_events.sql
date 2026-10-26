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

-- name: ListCustomerActivityEvents :many
-- Activity of one customer and its records (vehicles, jobs, sales, quotes,
-- leads, cari entries, job contracts) inside one organization, newest first.
-- The include_* flags drop record kinds the caller may not read.
WITH refs AS (
    SELECT c.uuid FROM customers c
    WHERE c.organization_id = sqlc.arg(organization_id) AND c.id = sqlc.arg(customer_id)
    UNION ALL
    SELECT v.uuid FROM customer_vehicles v
    WHERE v.organization_id = sqlc.arg(organization_id) AND v.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT j.uuid FROM service_jobs j
    WHERE sqlc.arg(include_jobs)::bool
      AND j.organization_id = sqlc.arg(organization_id) AND j.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ci.uuid FROM contract_instances ci
    JOIN service_jobs cj ON cj.uuid = ci.subject_uuid AND cj.organization_id = ci.organization_id
    WHERE sqlc.arg(include_contracts)::bool
      AND ci.organization_id = sqlc.arg(organization_id) AND ci.subject_type = 'service_job'
      AND cj.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ps.uuid FROM product_sales ps
    WHERE sqlc.arg(include_sales)::bool
      AND ps.organization_id = sqlc.arg(organization_id) AND ps.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT qt.uuid FROM quotes qt
    WHERE sqlc.arg(include_quotes)::bool
      AND qt.organization_id = sqlc.arg(organization_id) AND qt.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ld.uuid FROM leads ld
    WHERE sqlc.arg(include_leads)::bool
      AND ld.organization_id = sqlc.arg(organization_id) AND ld.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ce.uuid FROM cari_entries ce
    JOIN cari_accounts ca ON ca.id = ce.account_id AND ca.organization_id = ce.organization_id
    WHERE sqlc.arg(include_cari)::bool
      AND ce.organization_id = sqlc.arg(organization_id) AND ca.customer_id = sqlc.arg(customer_id)
)
SELECT a.uuid, a.action, a.resource, a.resource_uuid, a.payload, a.created_at,
       u.uuid AS actor_uuid, u.email AS actor_email, u.name AS actor_name, u.surname AS actor_surname
FROM activity_events a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.organization_id = sqlc.arg(organization_id)::bigint
  AND a.resource_uuid IN (SELECT r.uuid FROM refs r)
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountCustomerActivityEvents :one
WITH refs AS (
    SELECT c.uuid FROM customers c
    WHERE c.organization_id = sqlc.arg(organization_id) AND c.id = sqlc.arg(customer_id)
    UNION ALL
    SELECT v.uuid FROM customer_vehicles v
    WHERE v.organization_id = sqlc.arg(organization_id) AND v.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT j.uuid FROM service_jobs j
    WHERE sqlc.arg(include_jobs)::bool
      AND j.organization_id = sqlc.arg(organization_id) AND j.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ci.uuid FROM contract_instances ci
    JOIN service_jobs cj ON cj.uuid = ci.subject_uuid AND cj.organization_id = ci.organization_id
    WHERE sqlc.arg(include_contracts)::bool
      AND ci.organization_id = sqlc.arg(organization_id) AND ci.subject_type = 'service_job'
      AND cj.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ps.uuid FROM product_sales ps
    WHERE sqlc.arg(include_sales)::bool
      AND ps.organization_id = sqlc.arg(organization_id) AND ps.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT qt.uuid FROM quotes qt
    WHERE sqlc.arg(include_quotes)::bool
      AND qt.organization_id = sqlc.arg(organization_id) AND qt.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ld.uuid FROM leads ld
    WHERE sqlc.arg(include_leads)::bool
      AND ld.organization_id = sqlc.arg(organization_id) AND ld.customer_id = sqlc.arg(customer_id)
    UNION ALL
    SELECT ce.uuid FROM cari_entries ce
    JOIN cari_accounts ca ON ca.id = ce.account_id AND ca.organization_id = ce.organization_id
    WHERE sqlc.arg(include_cari)::bool
      AND ce.organization_id = sqlc.arg(organization_id) AND ca.customer_id = sqlc.arg(customer_id)
)
SELECT COUNT(*)::bigint
FROM activity_events a
WHERE a.organization_id = sqlc.arg(organization_id)::bigint
  AND a.resource_uuid IN (SELECT r.uuid FROM refs r);
