-- Tenant leads and their timeline. Every query is scoped by organization_id.

-- name: CreateLead :one
INSERT INTO leads (
    organization_id, customer_id, vehicle_id, vehicle_text, interest, source,
    temperature, status, notes, follow_up_date, assignee_user_id, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(customer_id), sqlc.narg(vehicle_id), sqlc.arg(vehicle_text),
    sqlc.arg(interest), sqlc.arg(source), sqlc.arg(temperature), 'new', sqlc.arg(notes),
    sqlc.narg(follow_up_date), sqlc.narg(assignee_user_id), sqlc.narg(created_by)
)
RETURNING *;

-- name: GetLeadRowByUUID :one
SELECT * FROM leads
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL;

-- name: GetLeadRowByUUIDForUpdate :one
SELECT * FROM leads
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
FOR UPDATE;

-- name: GetLeadDetail :one
SELECT
    l.*,
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    c.phone AS customer_phone,
    v.uuid AS vehicle_uuid,
    v.plate AS vehicle_plate,
    au.uuid AS assignee_uuid,
    COALESCE(NULLIF(TRIM(au.name || ' ' || au.surname), ''), au.email, '')::text AS assignee_name,
    COALESCE(NULLIF(TRIM(cu.name || ' ' || cu.surname), ''), cu.email, '')::text AS created_by_name
FROM leads l
JOIN customers c ON c.id = l.customer_id
LEFT JOIN customer_vehicles v ON v.id = l.vehicle_id AND v.deleted_at IS NULL
LEFT JOIN users au ON au.id = l.assignee_user_id
LEFT JOIN users cu ON cu.id = l.created_by
WHERE l.uuid = sqlc.arg(uuid) AND l.organization_id = sqlc.arg(organization_id) AND l.deleted_at IS NULL;

-- name: ListLeads :many
SELECT
    l.id, l.uuid, l.source, l.temperature, l.status, l.interest, l.vehicle_text,
    l.lost_reason, l.follow_up_date, l.created_at, l.updated_at,
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    c.phone AS customer_phone,
    v.plate AS vehicle_plate,
    au.uuid AS assignee_uuid,
    COALESCE(NULLIF(TRIM(au.name || ' ' || au.surname), ''), au.email, '')::text AS assignee_name,
    (SELECT COUNT(*)::bigint FROM quotes q WHERE q.lead_id = l.id) AS quote_count,
    (SELECT MAX(e.created_at) FROM lead_events e WHERE e.lead_id = l.id)::timestamptz AS last_activity_at
FROM leads l
JOIN customers c ON c.id = l.customer_id
LEFT JOIN customer_vehicles v ON v.id = l.vehicle_id AND v.deleted_at IS NULL
LEFT JOIN users au ON au.id = l.assignee_user_id
WHERE l.organization_id = sqlc.arg(organization_id) AND l.deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR l.status = sqlc.narg(status)
       OR (sqlc.narg(status)::text = 'open' AND l.status IN ('new', 'contacted', 'quoted')))
  AND (sqlc.narg(temperature)::text IS NULL OR l.temperature = sqlc.narg(temperature))
  AND (sqlc.narg(source)::text IS NULL OR l.source = sqlc.narg(source))
  AND (sqlc.narg(assignee_id)::bigint IS NULL OR l.assignee_user_id = sqlc.narg(assignee_id))
  AND (sqlc.narg(customer_id)::bigint IS NULL OR l.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(follow_up_before)::date IS NULL OR (
        l.follow_up_date IS NOT NULL AND l.follow_up_date < sqlc.narg(follow_up_before)
        AND l.status IN ('new', 'contacted', 'quoted')))
  AND (sqlc.narg(follow_up_on)::date IS NULL OR (
        l.follow_up_date = sqlc.narg(follow_up_on) AND l.status IN ('new', 'contacted', 'quoted')))
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR l.interest ILIKE '%' || sqlc.narg(q) || '%'
    OR l.vehicle_text ILIKE '%' || sqlc.narg(q) || '%'
    OR v.plate ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'follow_up_date' THEN l.follow_up_date END ASC NULLS LAST,
    CASE WHEN sqlc.arg(sort)::text = '-follow_up_date' THEN l.follow_up_date END DESC NULLS LAST,
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN l.created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-updated_at' THEN l.updated_at END DESC,
    l.created_at DESC, l.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountLeads :one
SELECT COUNT(*)::bigint
FROM leads l
JOIN customers c ON c.id = l.customer_id
LEFT JOIN customer_vehicles v ON v.id = l.vehicle_id AND v.deleted_at IS NULL
WHERE l.organization_id = sqlc.arg(organization_id) AND l.deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR l.status = sqlc.narg(status)
       OR (sqlc.narg(status)::text = 'open' AND l.status IN ('new', 'contacted', 'quoted')))
  AND (sqlc.narg(temperature)::text IS NULL OR l.temperature = sqlc.narg(temperature))
  AND (sqlc.narg(source)::text IS NULL OR l.source = sqlc.narg(source))
  AND (sqlc.narg(assignee_id)::bigint IS NULL OR l.assignee_user_id = sqlc.narg(assignee_id))
  AND (sqlc.narg(customer_id)::bigint IS NULL OR l.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(follow_up_before)::date IS NULL OR (
        l.follow_up_date IS NOT NULL AND l.follow_up_date < sqlc.narg(follow_up_before)
        AND l.status IN ('new', 'contacted', 'quoted')))
  AND (sqlc.narg(follow_up_on)::date IS NULL OR (
        l.follow_up_date = sqlc.narg(follow_up_on) AND l.status IN ('new', 'contacted', 'quoted')))
  AND (
    sqlc.narg(q)::text IS NULL
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR l.interest ILIKE '%' || sqlc.narg(q) || '%'
    OR l.vehicle_text ILIKE '%' || sqlc.narg(q) || '%'
    OR v.plate ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: LeadSummary :one
SELECT
    COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'quoted'))::bigint AS open,
    COUNT(*) FILTER (WHERE status = 'new')::bigint AS new_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'quoted') AND temperature = 'hot')::bigint AS hot,
    COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'quoted')
        AND follow_up_date < sqlc.arg(today)::date)::bigint AS overdue,
    COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'quoted')
        AND follow_up_date = sqlc.arg(today)::date)::bigint AS due_today,
    COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'quoted')
        AND assignee_user_id = sqlc.narg(user_id))::bigint AS mine
FROM leads
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL;

-- name: UpdateLead :one
UPDATE leads
SET customer_id = sqlc.arg(customer_id),
    vehicle_id = sqlc.narg(vehicle_id),
    vehicle_text = sqlc.arg(vehicle_text),
    interest = sqlc.arg(interest),
    source = sqlc.arg(source),
    temperature = sqlc.arg(temperature),
    status = sqlc.arg(status),
    lost_reason = sqlc.arg(lost_reason),
    notes = sqlc.arg(notes),
    follow_up_date = sqlc.narg(follow_up_date),
    assignee_user_id = sqlc.narg(assignee_user_id),
    contacted_at = sqlc.narg(contacted_at),
    closed_at = sqlc.narg(closed_at)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteLead :one
UPDATE leads SET deleted_at = NOW()
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING id, uuid;

-- name: SetLeadStatusByID :one
-- Used by the quotes module (quoted / won). Never reopens a closed lead
-- except to mark it won.
UPDATE leads
SET status = sqlc.arg(status)::text,
    closed_at = CASE WHEN sqlc.arg(status)::text IN ('won', 'lost') THEN NOW() ELSE closed_at END
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
RETURNING id, uuid, status;

-- name: CreateLeadEvent :one
INSERT INTO lead_events (
    organization_id, lead_id, kind, from_value, to_value, body,
    ref_type, ref_uuid, ref_label, actor_user_id
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(lead_id), sqlc.arg(kind), sqlc.arg(from_value),
    sqlc.arg(to_value), sqlc.arg(body), sqlc.arg(ref_type), sqlc.narg(ref_uuid),
    sqlc.arg(ref_label), sqlc.narg(actor_user_id)
)
RETURNING *;

-- name: ListLeadEvents :many
SELECT
    e.*,
    COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), u.email, '')::text AS actor_name
FROM lead_events e
LEFT JOIN users u ON u.id = e.actor_user_id
WHERE e.lead_id = sqlc.arg(lead_id) AND e.organization_id = sqlc.arg(organization_id)
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg(limit_count);

-- name: ListLeadQuotes :many
SELECT q.uuid, q.number, q.status, q.grand_total, q.currency, q.valid_until, q.created_at
FROM quotes q
WHERE q.lead_id = sqlc.arg(lead_id) AND q.organization_id = sqlc.arg(organization_id)
ORDER BY q.created_at DESC;

-- name: ListOrgMemberOptions :many
SELECT u.id, u.uuid,
    COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), u.email, '')::text AS label,
    om.role
FROM organization_members om
JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = sqlc.arg(organization_id) AND u.status = 'active'
ORDER BY u.name ASC, u.surname ASC;

-- name: GetOrgMemberUser :one
SELECT u.id, u.uuid,
    COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), u.email, '')::text AS label
FROM organization_members om
JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = sqlc.arg(organization_id) AND u.uuid = sqlc.arg(uuid);

-- name: GetOrgCustomerRef :one
SELECT id, uuid, name, phone FROM customers
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: GetOrgCustomerVehicleRef :one
SELECT v.id, v.uuid, v.customer_id, v.plate, v.model_id, v.year, b.name AS brand_name, m.name AS model_name
FROM customer_vehicles v
JOIN vehicle_models m ON m.id = v.model_id
JOIN vehicle_brands b ON b.id = m.brand_id
WHERE v.organization_id = sqlc.arg(organization_id) AND v.uuid = sqlc.arg(uuid) AND v.deleted_at IS NULL;
