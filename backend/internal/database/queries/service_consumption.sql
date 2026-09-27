-- Service recipes (products a service uses) and per-job product usage.

-- name: ListServiceProducts :many
SELECT sp.qty, sp.sort_order, p.id AS product_id, p.uuid AS product_uuid, p.name, p.unit,
       p.cost_price, p.track_stock, p.stock_quantity, p.is_active
FROM service_products sp
JOIN products p ON p.id = sp.product_id AND p.deleted_at IS NULL
WHERE sp.organization_id = sqlc.arg(organization_id) AND sp.service_id = sqlc.arg(service_id)
ORDER BY sp.sort_order, sp.id;

-- name: DeleteServiceProducts :exec
DELETE FROM service_products
WHERE organization_id = sqlc.arg(organization_id) AND service_id = sqlc.arg(service_id);

-- name: InsertServiceProduct :exec
INSERT INTO service_products (organization_id, service_id, product_id, qty, sort_order)
VALUES (sqlc.arg(organization_id), sqlc.arg(service_id), sqlc.arg(product_id), sqlc.arg(qty), sqlc.arg(sort_order));

-- name: ListRecipesForServices :many
SELECT sp.service_id, sp.qty, p.id AS product_id, p.name, p.unit, p.cost_price, p.track_stock
FROM service_products sp
JOIN products p ON p.id = sp.product_id AND p.deleted_at IS NULL
WHERE sp.organization_id = sqlc.arg(organization_id)
  AND sp.service_id = ANY(sqlc.arg(service_ids)::bigint[])
ORDER BY sp.service_id, sp.sort_order, sp.id;

-- name: CountServiceProductsByService :many
SELECT service_id, COUNT(*)::bigint AS product_count
FROM service_products
WHERE organization_id = sqlc.arg(organization_id)
GROUP BY service_id;

-- name: CreateJobConsumption :one
INSERT INTO service_job_consumptions (
    organization_id, job_id, product_id, service_id, name, unit, qty, unit_cost, stock_applied, created_by
) VALUES (
    sqlc.arg(organization_id), sqlc.arg(job_id), sqlc.arg(product_id), sqlc.narg(service_id), sqlc.arg(name),
    sqlc.arg(unit), sqlc.arg(qty), sqlc.arg(unit_cost), sqlc.arg(stock_applied), sqlc.narg(created_by)
)
RETURNING *;

-- name: ListJobConsumptions :many
SELECT c.*, p.uuid AS product_uuid, s.name AS service_name
FROM service_job_consumptions c
JOIN products p ON p.id = c.product_id
LEFT JOIN services s ON s.id = c.service_id
WHERE c.organization_id = sqlc.arg(organization_id) AND c.job_id = sqlc.arg(job_id)
ORDER BY c.id;

-- name: GetJobConsumptionForUpdate :one
SELECT * FROM service_job_consumptions
WHERE organization_id = sqlc.arg(organization_id) AND job_id = sqlc.arg(job_id) AND uuid = sqlc.arg(uuid)
FOR UPDATE;

-- name: GetActiveJobConsumptionByProduct :one
SELECT * FROM service_job_consumptions
WHERE organization_id = sqlc.arg(organization_id) AND job_id = sqlc.arg(job_id)
  AND product_id = sqlc.arg(product_id) AND reverted_at IS NULL
ORDER BY id
LIMIT 1
FOR UPDATE;

-- name: UpdateJobConsumptionQty :one
UPDATE service_job_consumptions SET qty = sqlc.arg(qty)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: DeleteJobConsumption :exec
DELETE FROM service_job_consumptions
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: RevertJobConsumptions :many
-- Marks the job's usage as given back; returns the rows whose stock must be restored.
UPDATE service_job_consumptions SET reverted_at = NOW()
WHERE organization_id = sqlc.arg(organization_id) AND job_id = sqlc.arg(job_id) AND reverted_at IS NULL
RETURNING product_id, qty, stock_applied;

-- name: AdjustProductStockByID :exec
UPDATE products
SET stock_quantity = stock_quantity + sqlc.arg(delta)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);
