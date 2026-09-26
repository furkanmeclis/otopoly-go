-- Tenant service jobs (operations / iş emri).

-- name: CreateServiceJob :one
INSERT INTO service_jobs (
    organization_id, customer_id, vehicle_id,
    customer_name, customer_phone, plate, vehicle_label,
    status, currency, notes, started_at, total_amount, created_by, assignee_user_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
RETURNING *;

-- name: CreateServiceJobLine :one
INSERT INTO service_job_lines (
    organization_id, job_id, line_type, service_id, name,
    unit_price, qty, vat_rate, line_total, currency, sort_order
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
RETURNING *;

-- name: CreateServiceJobPayment :one
INSERT INTO service_job_payments (
    organization_id, job_id, method, amount, currency, status,
    finance_account_id, finance_transaction_id, cari_entry_id, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: GetServiceJobByUUID :one
SELECT j.*,
       c.uuid AS customer_uuid,
       v.uuid AS vehicle_uuid,
       au.uuid AS assignee_uuid,
       CASE WHEN au.id IS NULL THEN '' ELSE trim(both FROM concat(au.name, ' ', au.surname)) END::text AS assignee_name
FROM service_jobs j
JOIN customers c ON c.id = j.customer_id
JOIN customer_vehicles v ON v.id = j.vehicle_id
LEFT JOIN users au ON au.id = j.assignee_user_id
WHERE j.uuid = $1 AND j.organization_id = $2;

-- name: GetServiceJobByID :one
SELECT * FROM service_jobs
WHERE id = $1 AND organization_id = $2;

-- name: ListServiceJobLines :many
SELECT l.*,
       s.uuid AS service_uuid
FROM service_job_lines l
LEFT JOIN services s ON s.id = l.service_id
WHERE l.job_id = $1 AND l.organization_id = $2
ORDER BY l.sort_order ASC, l.id ASC;

-- name: ListServiceJobPayments :many
SELECT p.*,
       fa.uuid AS finance_account_uuid,
       fa.name AS finance_account_name,
       ft.uuid AS finance_transaction_uuid,
       ce.uuid AS cari_entry_uuid
FROM service_job_payments p
LEFT JOIN finance_accounts fa ON fa.id = p.finance_account_id
LEFT JOIN finance_transactions ft ON ft.id = p.finance_transaction_id
LEFT JOIN cari_entries ce ON ce.id = p.cari_entry_id
WHERE p.job_id = $1 AND p.organization_id = $2
ORDER BY p.created_at ASC;

-- name: ListServiceJobs :many
SELECT j.*,
       c.uuid AS customer_uuid,
       v.uuid AS vehicle_uuid,
       au.uuid AS assignee_uuid,
       CASE WHEN au.id IS NULL THEN '' ELSE trim(both FROM concat(au.name, ' ', au.surname)) END::text AS assignee_name,
       vb.uuid AS brand_uuid,
       vb.name AS brand_name,
       vb.logo_object_key AS brand_logo_object_key
FROM service_jobs j
JOIN customers c ON c.id = j.customer_id
JOIN customer_vehicles v ON v.id = j.vehicle_id
JOIN vehicle_models vm ON vm.id = v.model_id
JOIN vehicle_brands vb ON vb.id = vm.brand_id
LEFT JOIN users au ON au.id = j.assignee_user_id
WHERE j.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR j.status = sqlc.narg(status))
  AND (
    (
      (sqlc.narg(date_from)::timestamptz IS NULL OR j.started_at >= sqlc.narg(date_from))
      AND (sqlc.narg(date_to)::timestamptz IS NULL OR j.started_at < sqlc.narg(date_to))
    )
    -- Multi-day work: unfinished jobs opened before the window stay listed.
    OR (
      sqlc.arg(include_open)::boolean
      AND j.status IN ('in_progress', 'ready')
      AND j.started_at < sqlc.narg(date_from)
    )
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR j.plate ILIKE '%' || sqlc.narg(q) || '%'
    OR j.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR j.vehicle_label ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY
    CASE WHEN sqlc.arg(sort)::text = 'started_at' THEN j.started_at END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-started_at' THEN j.started_at END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'total_amount' THEN j.total_amount END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-total_amount' THEN j.total_amount END DESC,
    CASE WHEN sqlc.arg(sort)::text = 'plate' THEN j.plate END ASC,
    CASE WHEN sqlc.arg(sort)::text = '-plate' THEN j.plate END DESC,
    j.started_at DESC
LIMIT sqlc.arg(limit_count) OFFSET sqlc.arg(offset_count);

-- name: CountServiceJobs :one
SELECT COUNT(*)::bigint
FROM service_jobs j
WHERE j.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR j.status = sqlc.narg(status))
  AND (
    (
      (sqlc.narg(date_from)::timestamptz IS NULL OR j.started_at >= sqlc.narg(date_from))
      AND (sqlc.narg(date_to)::timestamptz IS NULL OR j.started_at < sqlc.narg(date_to))
    )
    -- Multi-day work: unfinished jobs opened before the window stay listed.
    OR (
      sqlc.arg(include_open)::boolean
      AND j.status IN ('in_progress', 'ready')
      AND j.started_at < sqlc.narg(date_from)
    )
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR j.plate ILIKE '%' || sqlc.narg(q) || '%'
    OR j.customer_name ILIKE '%' || sqlc.narg(q) || '%'
    OR j.vehicle_label ILIKE '%' || sqlc.narg(q) || '%'
  );

-- name: ListServiceJobsByCustomer :many
SELECT j.*,
       c.uuid AS customer_uuid,
       v.uuid AS vehicle_uuid
FROM service_jobs j
JOIN customers c ON c.id = j.customer_id
JOIN customer_vehicles v ON v.id = j.vehicle_id
WHERE j.organization_id = $1 AND j.customer_id = $2
ORDER BY j.started_at DESC
LIMIT $3 OFFSET $4;

-- name: CountServiceJobsByCustomer :one
SELECT COUNT(*)::bigint
FROM service_jobs
WHERE organization_id = $1 AND customer_id = $2;

-- name: UpdateServiceJobNotes :one
UPDATE service_jobs
SET notes = $3
WHERE uuid = $1 AND organization_id = $2
  AND status IN ('in_progress', 'ready')
RETURNING *;

-- name: UpdateServiceJobAssignee :one
UPDATE service_jobs
SET assignee_user_id = sqlc.narg(assignee_user_id)
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id)
  AND status IN ('in_progress', 'ready', 'delivered')
RETURNING *;

-- name: MarkServiceJobDone :one
UPDATE service_jobs
SET status = 'ready', completed_at = COALESCE(completed_at, NOW())
WHERE uuid = $1 AND organization_id = $2
  AND status = 'in_progress'
RETURNING *;

-- name: MarkServiceJobDelivered :one
UPDATE service_jobs
SET status = 'delivered'
WHERE uuid = $1 AND organization_id = $2
  AND status IN ('ready', 'in_progress')
RETURNING *;

-- name: MarkServiceJobPaid :one
UPDATE service_jobs
SET payment_status = 'paid',
    completed_at = COALESCE(completed_at, NOW()),
    paid_at = NOW()
WHERE uuid = $1 AND organization_id = $2
  AND payment_status = 'unpaid'
  AND status IN ('in_progress', 'ready', 'delivered')
RETURNING *;

-- name: MarkServiceJobCancelled :one
UPDATE service_jobs
SET status = 'cancelled', completed_at = COALESCE(completed_at, NOW())
WHERE uuid = $1 AND organization_id = $2
  AND status IN ('in_progress', 'ready')
RETURNING *;

-- name: MarkServiceJobVoided :one
UPDATE service_jobs
SET status = 'voided'
WHERE uuid = $1 AND organization_id = $2
  AND payment_status = 'paid'
RETURNING *;

-- name: LinkServiceJobPaymentFinance :one
UPDATE service_job_payments
SET finance_transaction_id = $3, finance_account_id = $4
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: LinkServiceJobPaymentCari :one
UPDATE service_job_payments
SET cari_entry_id = $3
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: VoidServiceJobPayment :one
UPDATE service_job_payments
SET status = 'void', voided_at = NOW(), voided_by = $3
WHERE uuid = $1 AND organization_id = $2 AND status = 'posted'
RETURNING *;

-- name: SumServiceJobsDaily :one
SELECT
    COUNT(*)::bigint AS job_count,
    COALESCE(SUM(j.total_amount) FILTER (
        WHERE j.payment_status = 'paid'
          AND EXISTS (
              SELECT 1 FROM service_job_payments p
              WHERE p.job_id = j.id AND p.status = 'posted' AND p.method = 'card'
          )
    ), 0)::numeric AS card_total,
    COALESCE(SUM(j.total_amount) FILTER (
        WHERE j.payment_status = 'paid'
          AND EXISTS (
              SELECT 1 FROM service_job_payments p
              WHERE p.job_id = j.id AND p.status = 'posted' AND p.method = 'cari'
          )
    ), 0)::numeric AS cari_total,
    COALESCE(SUM(j.total_amount) FILTER (
        WHERE j.payment_status = 'paid'
          AND EXISTS (
              SELECT 1 FROM service_job_payments p
              WHERE p.job_id = j.id AND p.status = 'posted' AND p.method IN ('cash', 'card')
          )
    ), 0)::numeric AS net_total,
    COALESCE(SUM(j.total_amount) FILTER (WHERE j.payment_status = 'paid'), 0)::numeric AS paid_total
FROM service_jobs j
WHERE j.organization_id = $1
  AND j.started_at >= $2
  AND j.started_at < $3;

-- name: GetCustomerVehicleDetailByUUID :one
SELECT
    v.*,
    c.uuid AS customer_uuid,
    c.name AS customer_name,
    c.phone AS customer_phone,
    b.name AS brand_name,
    m.name AS model_name
FROM customer_vehicles v
JOIN customers c ON c.id = v.customer_id AND c.deleted_at IS NULL
JOIN vehicle_models m ON m.id = v.model_id
JOIN vehicle_brands b ON b.id = m.brand_id
WHERE v.uuid = $1 AND v.organization_id = $2 AND v.deleted_at IS NULL;

-- name: ListServiceJobsForExport :many
SELECT j.uuid, j.status, j.plate, j.vehicle_label, j.customer_name, j.customer_phone,
       j.total_amount, j.currency, j.started_at, j.paid_at, j.notes
FROM service_jobs j
WHERE j.organization_id = sqlc.arg(organization_id)
  AND (sqlc.narg(status)::text IS NULL OR j.status = sqlc.narg(status))
  AND (sqlc.narg(date_from)::timestamptz IS NULL OR j.started_at >= sqlc.narg(date_from))
  AND (sqlc.narg(date_to)::timestamptz IS NULL OR j.started_at < sqlc.narg(date_to))
  AND (
    sqlc.narg(q)::text IS NULL
    OR j.plate ILIKE '%' || sqlc.narg(q) || '%'
    OR j.customer_name ILIKE '%' || sqlc.narg(q) || '%'
  )
ORDER BY j.started_at DESC;

-- name: ListServiceJobsForSearch :many
SELECT j.uuid, j.plate, j.vehicle_label, j.customer_name, j.status, j.total_amount,
       j.currency, j.organization_id,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM service_jobs j
JOIN organizations o ON o.id = j.organization_id
WHERE j.status NOT IN ('cancelled', 'voided');

-- name: GetServiceJobForSearch :one
SELECT j.uuid, j.plate, j.vehicle_label, j.customer_name, j.status, j.total_amount,
       j.currency, j.organization_id,
       o.uuid AS organization_uuid, o.slug AS organization_slug
FROM service_jobs j
JOIN organizations o ON o.id = j.organization_id
WHERE j.uuid = $1 AND o.uuid = $2;
