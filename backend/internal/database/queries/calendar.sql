-- name: CreateCalendarEvent :one
INSERT INTO calendar_events (
    organization_id, title, description, location, starts_at, ends_at, all_day, color, created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetCalendarEventByUUID :one
SELECT * FROM calendar_events
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL;

-- name: UpdateCalendarEvent :one
UPDATE calendar_events
SET title = $3, description = $4, location = $5, starts_at = $6, ends_at = $7,
    all_day = $8, color = $9
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteCalendarEvent :one
UPDATE calendar_events
SET deleted_at = NOW()
WHERE uuid = $1 AND organization_id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: ListCalendarEventsInRange :many
-- Events overlapping [range_from, range_to).
SELECT * FROM calendar_events
WHERE organization_id = sqlc.arg(organization_id) AND deleted_at IS NULL
  AND starts_at < sqlc.arg(range_to) AND ends_at > sqlc.arg(range_from)
ORDER BY starts_at, id
LIMIT 1000;

-- name: CalendarJobsOpened :many
SELECT uuid, plate, customer_name, vehicle_label, status, payment_status, total_amount, currency, started_at
FROM service_jobs
WHERE organization_id = sqlc.arg(organization_id)
  AND status <> 'voided'
  AND started_at >= sqlc.arg(range_from) AND started_at < sqlc.arg(range_to)
ORDER BY started_at
LIMIT 1000;

-- name: CalendarJobsDelivered :many
SELECT uuid, plate, customer_name, vehicle_label, status, payment_status, total_amount, currency, delivered_at
FROM service_jobs
WHERE organization_id = sqlc.arg(organization_id)
  AND delivered_at IS NOT NULL
  AND status NOT IN ('voided', 'cancelled')
  AND delivered_at >= sqlc.arg(range_from) AND delivered_at < sqlc.arg(range_to)
ORDER BY delivered_at
LIMIT 1000;

-- name: CalendarTodos :many
SELECT t.uuid, t.title, t.status, t.due_date, t.due_time, c.name AS customer_name
FROM todos t
LEFT JOIN customers c ON c.id = t.customer_id AND c.organization_id = t.organization_id
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.due_date >= sqlc.arg(date_from) AND t.due_date < sqlc.arg(date_to)
ORDER BY t.due_date, t.due_time NULLS FIRST
LIMIT 1000;

-- name: CalendarQuotesExpiring :many
SELECT q.uuid, q.number, q.status, q.valid_until, q.grand_total, q.currency, c.name AS customer_name
FROM quotes q
JOIN customers c ON c.id = q.customer_id AND c.organization_id = q.organization_id
WHERE q.organization_id = sqlc.arg(organization_id)
  AND q.status IN ('draft', 'sent', 'viewed')
  AND q.valid_until >= sqlc.arg(date_from) AND q.valid_until < sqlc.arg(date_to)
ORDER BY q.valid_until
LIMIT 1000;

-- name: CalendarLeadFollowUps :many
SELECT l.uuid, l.interest, l.status, l.temperature, l.follow_up_date, c.name AS customer_name
FROM leads l
JOIN customers c ON c.id = l.customer_id AND c.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)
  AND l.deleted_at IS NULL
  AND l.status IN ('new', 'contacted', 'quoted')
  AND l.follow_up_date >= sqlc.arg(date_from) AND l.follow_up_date < sqlc.arg(date_to)
ORDER BY l.follow_up_date
LIMIT 1000;

-- name: CalendarFinanceDaily :many
-- Posted income / expense per day (one calendar row per day, type and currency).
SELECT transaction_date, type, currency, COUNT(*)::bigint AS count, COALESCE(SUM(amount), 0)::numeric AS total
FROM finance_transactions
WHERE organization_id = sqlc.arg(organization_id)
  AND status = 'posted'
  AND type IN ('income', 'expense')
  AND transaction_date >= sqlc.arg(date_from) AND transaction_date < sqlc.arg(date_to)
GROUP BY transaction_date, type, currency
ORDER BY transaction_date, type;

-- name: CalendarSales :many
SELECT uuid, customer_name, total_amount, currency, method, sold_at
FROM product_sales
WHERE organization_id = sqlc.arg(organization_id)
  AND status = 'posted'
  AND sold_at >= sqlc.arg(range_from) AND sold_at < sqlc.arg(range_to)
ORDER BY sold_at
LIMIT 1000;

-- name: CalendarPurchases :many
SELECT uuid, supplier_name, total_amount, currency, method, purchased_at
FROM purchases
WHERE organization_id = sqlc.arg(organization_id)
  AND status = 'posted'
  AND purchased_at >= sqlc.arg(range_from) AND purchased_at < sqlc.arg(range_to)
ORDER BY purchased_at
LIMIT 1000;

-- name: CalendarContracts :many
SELECT uuid, title, number, status, executed_at
FROM contract_instances
WHERE organization_id = sqlc.arg(organization_id)
  AND executed_at IS NOT NULL
  AND status = 'executed'
  AND executed_at >= sqlc.arg(range_from) AND executed_at < sqlc.arg(range_to)
ORDER BY executed_at
LIMIT 1000;
