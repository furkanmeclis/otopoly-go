-- Todo ↔ lead / quote links (todos LinkResolver). Every query is org-scoped.

-- name: ResolveTodoLeadLink :one
SELECT id FROM leads
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: ResolveTodoQuoteLink :one
SELECT id FROM quotes
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid);

-- name: DescribeTodoLeadLinks :many
SELECT l.id, l.uuid,
    (c.name || CASE WHEN l.interest <> '' THEN ' — ' || l.interest ELSE '' END)::text AS label
FROM leads l
JOIN customers c ON c.id = l.customer_id
WHERE l.organization_id = sqlc.arg(organization_id)
  AND l.id = ANY(sqlc.arg(ids)::bigint[])
  AND l.deleted_at IS NULL;

-- name: DescribeTodoQuoteLinks :many
SELECT q.id, q.uuid, (q.number || ' · ' || c.name)::text AS label
FROM quotes q
JOIN customers c ON c.id = q.customer_id
WHERE q.organization_id = sqlc.arg(organization_id)
  AND q.id = ANY(sqlc.arg(ids)::bigint[]);
