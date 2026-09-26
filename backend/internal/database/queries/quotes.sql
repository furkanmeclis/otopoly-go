-- Tenant quotes (teklifler). Tenant queries are scoped by organization_id;
-- public queries look up by the unguessable share_token only.

-- name: NextQuoteNumber :one
INSERT INTO quote_counters (organization_id, year, last_number)
VALUES (sqlc.arg(organization_id), sqlc.arg(year), 1)
ON CONFLICT (organization_id, year)
DO UPDATE SET last_number = quote_counters.last_number + 1, updated_at = NOW()
RETURNING last_number;

-- name: CreateQuote :one
INSERT INTO quotes (
    organization_id, number, customer_id, lead_id, vehicle_id, vehicle_plate, vehicle_label,
    vehicle_model_id, vehicle_year, status, currency, prices_include_vat, discount_type,
    discount_value, subtotal, discount_total, vat_total, grand_total, valid_until, notes,
    terms, share_token, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(number), sqlc.arg(customer_id), sqlc.narg(lead_id),
    sqlc.narg(vehicle_id), sqlc.arg(vehicle_plate), sqlc.arg(vehicle_label),
    sqlc.narg(vehicle_model_id), sqlc.narg(vehicle_year), 'draft', sqlc.arg(currency),
    sqlc.arg(prices_include_vat), sqlc.arg(discount_type), sqlc.arg(discount_value),
    sqlc.arg(subtotal), sqlc.arg(discount_total), sqlc.arg(vat_total), sqlc.arg(grand_total),
    sqlc.narg(valid_until), sqlc.arg(notes), sqlc.arg(terms), sqlc.arg(share_token),
    sqlc.narg(created_by)
)
RETURNING *;

-- name: UpdateQuoteContent :one
UPDATE quotes
SET customer_id = sqlc.arg(customer_id),
    lead_id = sqlc.narg(lead_id),
    vehicle_id = sqlc.narg(vehicle_id),
    vehicle_plate = sqlc.arg(vehicle_plate),
    vehicle_label = sqlc.arg(vehicle_label),
    vehicle_model_id = sqlc.narg(vehicle_model_id),
    vehicle_year = sqlc.narg(vehicle_year),
    currency = sqlc.arg(currency),
    prices_include_vat = sqlc.arg(prices_include_vat),
    discount_type = sqlc.arg(discount_type),
    discount_value = sqlc.arg(discount_value),
    subtotal = sqlc.arg(subtotal),
    discount_total = sqlc.arg(discount_total),
    vat_total = sqlc.arg(vat_total),
    grand_total = sqlc.arg(grand_total),
    valid_until = sqlc.narg(valid_until),
    notes = sqlc.arg(notes),
    terms = sqlc.arg(terms),
    pdf_sha256 = ''
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: GetQuoteRowByUUID :one
SELECT * FROM quotes
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id);

-- name: GetQuoteRowByUUIDForUpdate :one
SELECT * FROM quotes
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id)
FOR UPDATE;

-- name: GetQuoteRowByID :one
SELECT * FROM quotes WHERE id = sqlc.arg(id);

-- name: GetQuoteByShareToken :one
SELECT * FROM quotes WHERE share_token = sqlc.arg(share_token);

-- name: GetQuoteByShareTokenForUpdate :one
SELECT * FROM quotes WHERE share_token = sqlc.arg(share_token) FOR UPDATE;

-- name: GetQuoteRefs :one
-- Joined display fields for one quote (detail, PDF, public view).
SELECT
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    c.phone AS customer_phone,
    c.email AS customer_email,
    c.tax_id AS customer_tax_id,
    c.tax_office AS customer_tax_office,
    l.uuid AS lead_uuid,
    v.uuid AS vehicle_uuid,
    m.uuid AS vehicle_model_uuid,
    COALESCE(b.name || ' ' || m.name, '')::text AS vehicle_model_label,
    j.uuid AS job_uuid,
    COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), u.email, '')::text AS created_by_name
FROM quotes q
JOIN customers c ON c.id = q.customer_id
LEFT JOIN leads l ON l.id = q.lead_id
LEFT JOIN customer_vehicles v ON v.id = q.vehicle_id
LEFT JOIN vehicle_models m ON m.id = q.vehicle_model_id
LEFT JOIN vehicle_brands b ON b.id = m.brand_id
LEFT JOIN service_jobs j ON j.id = q.job_id
LEFT JOIN users u ON u.id = q.created_by
WHERE q.id = sqlc.arg(id);

-- name: ListQuotes :many
SELECT
    q.id, q.uuid, q.number, q.status, q.currency, q.grand_total, q.valid_until,
    q.vehicle_plate, q.vehicle_label, q.sent_at, q.viewed_at, q.created_at, q.updated_at,
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    c.phone AS customer_phone,
    l.uuid AS lead_uuid,
    j.uuid AS job_uuid,
    (SELECT COUNT(*)::bigint FROM quote_lines ql WHERE ql.quote_id = q.id) AS line_count
FROM quotes q
JOIN customers c ON c.id = q.customer_id
LEFT JOIN leads l ON l.id = q.lead_id
LEFT JOIN service_jobs j ON j.id = q.job_id
WHERE q.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR q.status = sqlc.narg(status)
       OR (sqlc.narg(status)::text = 'open' AND q.status IN ('draft', 'sent', 'viewed')))
  AND (sqlc.narg(customer_id)::bigint IS NULL OR q.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(lead_id)::bigint IS NULL OR q.lead_id = sqlc.narg(lead_id))
  AND (
    sqlc.narg(q)::text IS NULL
    OR q.number ILIKE '%' || sqlc.narg(q) || '%'
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR q.vehicle_plate ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'created_at' THEN q.created_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = 'grand_total' THEN q.grand_total END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-grand_total' THEN q.grand_total END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'valid_until' THEN q.valid_until END ASC NULLS LAST,
    q.created_at DESC, q.id DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountQuotes :one
SELECT COUNT(*)::bigint
FROM quotes q
JOIN customers c ON c.id = q.customer_id
WHERE q.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR q.status = sqlc.narg(status)
       OR (sqlc.narg(status)::text = 'open' AND q.status IN ('draft', 'sent', 'viewed')))
  AND (sqlc.narg(customer_id)::bigint IS NULL OR q.customer_id = sqlc.narg(customer_id))
  AND (sqlc.narg(lead_id)::bigint IS NULL OR q.lead_id = sqlc.narg(lead_id))
  AND (
    sqlc.narg(q)::text IS NULL
    OR q.number ILIKE '%' || sqlc.narg(q) || '%'
    OR c.name ILIKE '%' || sqlc.narg(q) || '%'
    OR c.phone ILIKE '%' || sqlc.narg(q) || '%'
    OR q.vehicle_plate ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: QuoteSummary :one
SELECT
    COUNT(*) FILTER (WHERE status IN ('draft', 'sent', 'viewed'))::bigint AS open_count,
    COALESCE(SUM(grand_total) FILTER (WHERE status IN ('sent', 'viewed')), 0)::numeric AS pending_total,
    COUNT(*) FILTER (WHERE status = 'draft')::bigint AS draft_count,
    COUNT(*) FILTER (WHERE status IN ('sent', 'viewed'))::bigint AS awaiting_count,
    COUNT(*) FILTER (WHERE status IN ('sent', 'viewed') AND valid_until IS NOT NULL
        AND valid_until >= sqlc.arg(today)::date
        AND valid_until <= sqlc.arg(today)::date + 3)::bigint AS expiring_soon,
    COUNT(*) FILTER (WHERE status = 'accepted' AND accepted_at >= sqlc.arg(month_start)::timestamptz)::bigint AS accepted_month,
    COALESCE(SUM(grand_total) FILTER (WHERE status = 'accepted'
        AND accepted_at >= sqlc.arg(month_start)::timestamptz), 0)::numeric AS accepted_month_total
FROM quotes
WHERE organization_id = sqlc.arg(organization_id) AND currency = sqlc.arg(currency);

-- name: CreateQuoteLine :one
INSERT INTO quote_lines (
    organization_id, quote_id, line_type, service_id, product_id, description, quantity,
    unit, unit_price, discount_type, discount_value, vat_rate, line_subtotal, line_discount,
    quote_discount_share, net_amount, vat_amount, line_total, sort_order
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(quote_id), sqlc.arg(line_type), sqlc.narg(service_id),
    sqlc.narg(product_id), sqlc.arg(description), sqlc.arg(quantity), sqlc.arg(unit),
    sqlc.arg(unit_price), sqlc.arg(discount_type), sqlc.arg(discount_value), sqlc.arg(vat_rate),
    sqlc.arg(line_subtotal), sqlc.arg(line_discount), sqlc.arg(quote_discount_share),
    sqlc.arg(net_amount), sqlc.arg(vat_amount), sqlc.arg(line_total), sqlc.arg(sort_order)
)
RETURNING *;

-- name: DeleteQuoteLines :exec
DELETE FROM quote_lines WHERE quote_id = sqlc.arg(quote_id) AND organization_id = sqlc.arg(organization_id);

-- name: ListQuoteLines :many
SELECT ql.*, s.uuid AS service_uuid, p.uuid AS product_uuid
FROM quote_lines ql
LEFT JOIN services s ON s.id = ql.service_id
LEFT JOIN products p ON p.id = ql.product_id
WHERE ql.quote_id = sqlc.arg(quote_id)
ORDER BY ql.sort_order ASC, ql.id ASC;

-- name: SetQuoteStatus :one
-- Guarded transition: only applies when the row is still in from_status.
UPDATE quotes
SET status = sqlc.arg(to_status)::text,
    sent_at = CASE WHEN sqlc.arg(to_status)::text = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END,
    viewed_at = CASE WHEN sqlc.arg(to_status)::text = 'viewed' AND viewed_at IS NULL THEN NOW() ELSE viewed_at END,
    accepted_at = CASE WHEN sqlc.arg(to_status)::text = 'accepted' THEN NOW() ELSE accepted_at END,
    rejected_at = CASE WHEN sqlc.arg(to_status)::text = 'rejected' THEN NOW() ELSE rejected_at END,
    cancelled_at = CASE WHEN sqlc.arg(to_status)::text = 'cancelled' THEN NOW() ELSE cancelled_at END,
    expired_at = CASE WHEN sqlc.arg(to_status)::text = 'expired' THEN NOW() ELSE expired_at END,
    decision_note = CASE WHEN sqlc.arg(to_status)::text IN ('accepted', 'rejected') THEN sqlc.arg(decision_note) ELSE decision_note END,
    decision_channel = CASE WHEN sqlc.arg(to_status)::text IN ('accepted', 'rejected') THEN sqlc.arg(decision_channel) ELSE decision_channel END,
    decision_ip = CASE WHEN sqlc.arg(to_status)::text IN ('accepted', 'rejected') THEN sqlc.arg(decision_ip) ELSE decision_ip END,
    decision_user_agent = CASE WHEN sqlc.arg(to_status)::text IN ('accepted', 'rejected') THEN sqlc.arg(decision_user_agent) ELSE decision_user_agent END
WHERE id = sqlc.arg(id) AND status = sqlc.arg(from_status)::text
RETURNING *;

-- name: IncrementQuoteViews :exec
UPDATE quotes SET view_count = view_count + 1,
    viewed_at = COALESCE(viewed_at, NOW())
WHERE id = sqlc.arg(id);

-- name: SetQuotePDF :exec
UPDATE quotes SET pdf_object_key = sqlc.arg(pdf_object_key), pdf_sha256 = sqlc.arg(pdf_sha256)
WHERE id = sqlc.arg(id);

-- name: LinkQuoteJob :one
UPDATE quotes SET job_id = sqlc.arg(job_id), converted_at = NOW()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND job_id IS NULL
RETURNING *;

-- name: ExpireDueQuotes :many
-- Marks open quotes whose valid_until day has passed as expired. Idempotent:
-- a second run finds nothing; accepted / rejected / cancelled rows are never touched.
WITH due AS (
    SELECT id, status FROM quotes
    WHERE valid_until IS NOT NULL
      AND valid_until < sqlc.arg(today)::date
      AND status IN ('draft', 'sent', 'viewed')
    ORDER BY id
    LIMIT sqlc.arg(limit_count)
    FOR UPDATE SKIP LOCKED
)
UPDATE quotes q
SET status = 'expired', expired_at = NOW()
FROM due
WHERE q.id = due.id
RETURNING q.id, q.uuid, q.organization_id, q.lead_id, due.status AS from_status;

-- name: CreateQuoteEvent :one
INSERT INTO quote_events (
    organization_id, quote_id, kind, from_status, to_status, body, channel, ip, user_agent, actor_user_id
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(quote_id), sqlc.arg(kind), sqlc.arg(from_status),
    sqlc.arg(to_status), sqlc.arg(body), sqlc.arg(channel), sqlc.arg(ip), sqlc.arg(user_agent),
    sqlc.narg(actor_user_id)
)
RETURNING *;

-- name: ListQuoteEvents :many
SELECT e.*,
    COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), u.email, '')::text AS actor_name
FROM quote_events e
LEFT JOIN users u ON u.id = e.actor_user_id
WHERE e.quote_id = sqlc.arg(quote_id)
ORDER BY e.created_at DESC, e.id DESC
LIMIT 200;

-- name: CreateQuoteDelivery :one
INSERT INTO quote_deliveries (organization_id, quote_id, channel, recipient, status, created_by)
VALUES (sqlc.arg(organization_id), sqlc.arg(quote_id), sqlc.arg(channel), sqlc.arg(recipient), 'pending', sqlc.narg(created_by))
RETURNING *;

-- name: GetQuoteDeliveryByUUID :one
SELECT * FROM quote_deliveries
WHERE uuid = sqlc.arg(uuid) AND quote_id = sqlc.arg(quote_id) AND organization_id = sqlc.arg(organization_id);

-- name: FinishQuoteDelivery :one
UPDATE quote_deliveries
SET status = sqlc.arg(status)::text,
    error = sqlc.arg(error),
    provider_ref = sqlc.arg(provider_ref),
    recipient = sqlc.arg(recipient),
    attempt_count = attempt_count + 1,
    last_attempt_at = NOW(),
    sent_at = CASE WHEN sqlc.arg(status)::text = 'sent' THEN NOW() ELSE sent_at END
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ListQuoteDeliveries :many
SELECT * FROM quote_deliveries WHERE quote_id = sqlc.arg(quote_id)
ORDER BY created_at DESC, id DESC;

-- name: CreateQuoteReminder :one
INSERT INTO quote_reminders (organization_id, quote_id, kind, offset_days, fire_at, status)
VALUES (sqlc.arg(organization_id), sqlc.arg(quote_id), sqlc.arg(kind), sqlc.arg(offset_days), sqlc.arg(fire_at), 'pending')
RETURNING *;

-- name: ListQuoteReminders :many
SELECT * FROM quote_reminders WHERE quote_id = sqlc.arg(quote_id)
ORDER BY fire_at ASC, id ASC;

-- name: CancelOpenQuoteReminders :many
UPDATE quote_reminders
SET status = 'cancelled', cancelled_at = NOW()
WHERE quote_id = sqlc.arg(quote_id) AND status IN ('pending', 'scheduled')
RETURNING *;

-- name: SetQuoteReminderScheduled :exec
UPDATE quote_reminders
SET status = CASE WHEN sqlc.arg(ok)::boolean THEN 'scheduled' ELSE status END,
    external_ref = sqlc.arg(external_ref),
    error = sqlc.arg(error)
WHERE id = sqlc.arg(id) AND status IN ('pending', 'scheduled');

-- name: GetQuoteReminderByUUID :one
SELECT * FROM quote_reminders WHERE uuid = sqlc.arg(uuid);

-- name: FinishQuoteReminder :one
UPDATE quote_reminders
SET status = sqlc.arg(status)::text,
    error = sqlc.arg(error),
    sent_at = CASE WHEN sqlc.arg(status)::text = 'sent' THEN NOW() ELSE sent_at END
WHERE id = sqlc.arg(id) AND status IN ('pending', 'scheduled')
RETURNING *;

-- name: GetOrgServiceRef :one
SELECT id, uuid, name, price, vat_rate, currency FROM services
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: GetOrgProductRef :one
SELECT id, uuid, name, sale_price, vat_rate, currency, unit FROM products
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: GetOrgLeadRef :one
SELECT id, uuid, customer_id, status, assignee_user_id FROM leads
WHERE organization_id = sqlc.arg(organization_id) AND uuid = sqlc.arg(uuid) AND deleted_at IS NULL;

-- name: GetLeadRefByID :one
SELECT id, uuid, customer_id, status, assignee_user_id FROM leads
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: GetVehicleModelRef :one
SELECT m.id, m.uuid, b.name AS brand_name, m.name AS model_name
FROM vehicle_models m
JOIN vehicle_brands b ON b.id = m.brand_id
WHERE m.uuid = sqlc.arg(uuid) AND m.deleted_at IS NULL;

-- name: GetQuoteReminderByID :one
SELECT * FROM quote_reminders WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: FailQuoteDeliveryByRef :one
-- Async WhatsApp failure reported after the delivery was handed off.
UPDATE quote_deliveries
SET status = 'failed', error = sqlc.arg(error), sent_at = NULL
WHERE organization_id = sqlc.arg(organization_id) AND provider_ref = sqlc.arg(provider_ref)
  AND provider_ref <> '' AND status = 'sent'
RETURNING *;

-- name: FailQuoteReminderByRef :one
-- Async WhatsApp failure of a reminder that was already handed off.
UPDATE quote_reminders
SET status = 'failed', error = sqlc.arg(error)
WHERE organization_id = sqlc.arg(organization_id) AND external_ref = sqlc.arg(external_ref)
  AND external_ref <> '' AND status IN ('scheduled', 'sent')
RETURNING *;

-- name: GetQuoteNotifyPeople :one
-- Team members related to a quote (creator, lead assignee) for internal notifications.
SELECT
    q.created_by,
    COALESCE(NULLIF(TRIM(u.name || ' ' || u.surname), ''), u.email, '')::text AS created_by_name,
    l.assignee_user_id AS lead_assignee_id,
    c.name AS customer_name
FROM quotes q
JOIN customers c ON c.id = q.customer_id
LEFT JOIN users u ON u.id = q.created_by
LEFT JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id AND l.deleted_at IS NULL
WHERE q.id = sqlc.arg(id) AND q.organization_id = sqlc.arg(organization_id);
