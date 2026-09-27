-- Source documents behind finance transactions (job payment, sale,
-- purchase, cari collection) for the transaction detail page.

-- name: GetFinanceSourceJob :one
SELECT j.id, j.uuid, j.plate, j.customer_name, j.vehicle_label, j.total_amount, j.currency, j.started_at
FROM service_job_payments p
JOIN service_jobs j ON j.id = p.job_id AND j.organization_id = p.organization_id
WHERE p.uuid = sqlc.arg(payment_uuid) AND p.organization_id = sqlc.arg(organization_id);

-- name: ListFinanceSourceJobLines :many
SELECT line_type, name, qty, unit_price, line_total
FROM service_job_lines
WHERE organization_id = sqlc.arg(organization_id) AND job_id = sqlc.arg(job_id)
ORDER BY sort_order, id;

-- name: GetFinanceSourceSale :one
SELECT id, uuid, customer_name, total_amount, currency, sold_at
FROM product_sales
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id);

-- name: ListFinanceSourceSaleLines :many
SELECT name, qty, unit_price, line_total
FROM product_sale_lines
WHERE organization_id = sqlc.arg(organization_id) AND sale_id = sqlc.arg(sale_id)
ORDER BY sort_order, id;

-- name: GetFinanceSourcePurchase :one
SELECT id, uuid, supplier_name, total_amount, currency, purchased_at
FROM purchases
WHERE uuid = sqlc.arg(uuid) AND organization_id = sqlc.arg(organization_id);

-- name: ListFinanceSourcePurchaseLines :many
SELECT name, qty, unit_cost, line_total
FROM purchase_lines
WHERE organization_id = sqlc.arg(organization_id) AND purchase_id = sqlc.arg(purchase_id)
ORDER BY sort_order, id;

-- name: GetFinanceSourceCari :one
SELECT e.uuid, e.description, a.uuid AS account_uuid, c.name AS customer_name
FROM cari_entries e
JOIN cari_accounts a ON a.id = e.account_id
JOIN customers c ON c.id = a.customer_id
WHERE e.uuid = sqlc.arg(uuid) AND e.organization_id = sqlc.arg(organization_id);
