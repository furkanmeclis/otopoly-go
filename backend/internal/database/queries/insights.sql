-- 360° detail page aggregates (product, service, customer, supplier).
-- Every query is scoped by organization_id; the record id comes from a
-- lookup that is itself organization scoped.

-- ============================================================================
-- Product
-- ============================================================================

-- name: GetProductSalesStats :one
SELECT
    COUNT(DISTINCT s.id)::bigint                 AS sale_count,
    COALESCE(SUM(l.qty), 0)::numeric(18, 3)      AS sold_qty,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS revenue,
    MAX(s.sold_at)::timestamptz                  AS last_sold_at
FROM product_sale_lines l
JOIN product_sales s ON s.id = l.sale_id AND s.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.product_id = sqlc.arg(product_id)::bigint
  AND s.status = 'posted';

-- name: GetProductPurchaseStats :one
SELECT
    COUNT(DISTINCT p.id)::bigint                   AS purchase_count,
    COALESCE(SUM(l.qty), 0)::numeric(18, 3)        AS purchased_qty,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS spend,
    MAX(p.purchased_at)::timestamptz               AS last_purchased_at
FROM purchase_lines l
JOIN purchases p ON p.id = l.purchase_id AND p.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.product_id = sqlc.arg(product_id)::bigint
  AND p.status = 'posted';

-- name: GetProductJobStats :one
-- Job usage: product lines billed on jobs plus consumptions (recipe / manual).
SELECT
    jl.line_job_count,
    jl.line_qty,
    jl.line_revenue,
    jc.consumption_job_count,
    jc.consumed_qty,
    jc.last_consumed_at
FROM (
    SELECT
        COUNT(DISTINCT j.id)::bigint                   AS line_job_count,
        COALESCE(SUM(l.qty), 0)::numeric(18, 3)        AS line_qty,
        COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS line_revenue
    FROM service_job_lines l
    JOIN service_jobs j ON j.id = l.job_id AND j.organization_id = l.organization_id
    WHERE l.organization_id = sqlc.arg(organization_id)::bigint
      AND l.product_id = sqlc.arg(product_id)::bigint
      AND j.status NOT IN ('cancelled', 'voided')
) jl,
(
    SELECT
        COUNT(DISTINCT c.job_id)::bigint        AS consumption_job_count,
        COALESCE(SUM(c.qty), 0)::numeric(18, 3) AS consumed_qty,
        MAX(c.created_at)::timestamptz          AS last_consumed_at
    FROM service_job_consumptions c
    WHERE c.organization_id = sqlc.arg(organization_id)::bigint
      AND c.product_id = sqlc.arg(product_id)::bigint
      AND c.reverted_at IS NULL
) jc;

-- name: ListProductMonthlySales :many
SELECT
    date_trunc('month', s.sold_at)::timestamptz    AS month,
    COALESCE(SUM(l.qty), 0)::numeric(18, 3)        AS qty,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS revenue
FROM product_sale_lines l
JOIN product_sales s ON s.id = l.sale_id AND s.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.product_id = sqlc.arg(product_id)::bigint
  AND s.status = 'posted'
  AND s.sold_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: ListProductSaleMovements :many
SELECT
    s.uuid           AS ref_uuid,
    s.status,
    s.sold_at        AS occurred_at,
    s.customer_name  AS party_name,
    c.uuid           AS party_uuid,
    l.qty,
    l.unit_price,
    l.line_total,
    l.currency
FROM product_sale_lines l
JOIN product_sales s ON s.id = l.sale_id AND s.organization_id = l.organization_id
LEFT JOIN customers c ON c.id = s.customer_id AND c.organization_id = s.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.product_id = sqlc.arg(product_id)::bigint
ORDER BY s.sold_at DESC, l.id DESC
LIMIT sqlc.arg(limit_count);

-- name: ListProductPurchaseMovements :many
SELECT
    p.uuid           AS ref_uuid,
    p.status,
    p.purchased_at   AS occurred_at,
    p.supplier_name  AS party_name,
    sp.uuid          AS party_uuid,
    l.qty,
    l.unit_cost,
    l.line_total,
    l.currency
FROM purchase_lines l
JOIN purchases p ON p.id = l.purchase_id AND p.organization_id = l.organization_id
JOIN suppliers sp ON sp.id = p.supplier_id AND sp.organization_id = p.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.product_id = sqlc.arg(product_id)::bigint
ORDER BY p.purchased_at DESC, l.id DESC
LIMIT sqlc.arg(limit_count);

-- name: ListProductConsumptionMovements :many
SELECT
    j.uuid          AS ref_uuid,
    j.status,
    c.created_at    AS occurred_at,
    j.customer_name AS party_name,
    cu.uuid         AS party_uuid,
    j.plate,
    c.qty,
    c.unit_cost,
    c.stock_applied,
    c.reverted_at,
    COALESCE(sv.name, '')::text AS service_name,
    j.currency
FROM service_job_consumptions c
JOIN service_jobs j ON j.id = c.job_id AND j.organization_id = c.organization_id
JOIN customers cu ON cu.id = j.customer_id AND cu.organization_id = j.organization_id
LEFT JOIN services sv ON sv.id = c.service_id
WHERE c.organization_id = sqlc.arg(organization_id)::bigint
  AND c.product_id = sqlc.arg(product_id)::bigint
ORDER BY c.created_at DESC, c.id DESC
LIMIT sqlc.arg(limit_count);

-- ============================================================================
-- Service
-- ============================================================================

-- name: GetServiceUsageStats :one
SELECT
    COUNT(*)::bigint                                AS line_count,
    COUNT(DISTINCT j.id)::bigint                    AS job_count,
    COUNT(DISTINCT j.customer_id)::bigint           AS customer_count,
    COALESCE(SUM(l.qty), 0)::numeric(18, 3)         AS qty,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2)  AS revenue,
    COALESCE(AVG(l.unit_price), 0)::numeric(18, 2)  AS avg_unit_price,
    COALESCE(
        AVG(EXTRACT(EPOCH FROM (j.completed_at - j.started_at)) / 60)
            FILTER (WHERE j.completed_at IS NOT NULL AND j.completed_at > j.started_at),
        0
    )::numeric(18, 1)                               AS avg_job_minutes,
    MIN(j.started_at)::timestamptz                  AS first_used_at,
    MAX(j.started_at)::timestamptz                  AS last_used_at
FROM service_job_lines l
JOIN service_jobs j ON j.id = l.job_id AND j.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.service_id = sqlc.arg(service_id)::bigint
  AND j.status NOT IN ('cancelled', 'voided');

-- name: ListServiceMonthlyUsage :many
SELECT
    date_trunc('month', j.started_at)::timestamptz AS month,
    COUNT(DISTINCT j.id)::bigint                   AS job_count,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS revenue
FROM service_job_lines l
JOIN service_jobs j ON j.id = l.job_id AND j.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.service_id = sqlc.arg(service_id)::bigint
  AND j.status NOT IN ('cancelled', 'voided')
  AND j.started_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: ListServiceJobUsage :many
SELECT
    j.uuid,
    j.status,
    j.payment_status,
    j.started_at,
    j.completed_at,
    j.plate,
    j.vehicle_label,
    j.customer_name,
    c.uuid             AS customer_uuid,
    vb.uuid            AS brand_uuid,
    vb.name            AS brand_name,
    vb.logo_object_key AS brand_logo_object_key,
    SUM(l.qty)::numeric(18, 3)        AS qty,
    SUM(l.line_total)::numeric(18, 2) AS line_total,
    j.currency
FROM service_job_lines l
JOIN service_jobs j ON j.id = l.job_id AND j.organization_id = l.organization_id
JOIN customers c ON c.id = j.customer_id AND c.organization_id = j.organization_id
JOIN customer_vehicles v ON v.id = j.vehicle_id AND v.organization_id = j.organization_id
JOIN vehicle_models vm ON vm.id = v.model_id
JOIN vehicle_brands vb ON vb.id = vm.brand_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND l.service_id = sqlc.arg(service_id)::bigint
GROUP BY j.id, c.uuid, vb.uuid, vb.name, vb.logo_object_key
ORDER BY j.started_at DESC
LIMIT sqlc.arg(limit_count);

-- ============================================================================
-- Customer
-- ============================================================================

-- name: GetCustomerJobStats :one
SELECT
    COUNT(*)::bigint AS job_count,
    COUNT(*) FILTER (WHERE j.status IN ('in_progress', 'ready'))::bigint AS open_job_count,
    COUNT(*) FILTER (
        WHERE j.payment_status = 'unpaid' AND j.status NOT IN ('cancelled', 'voided')
    )::bigint AS unpaid_job_count,
    COALESCE(SUM(j.total_amount) FILTER (WHERE j.status NOT IN ('cancelled', 'voided')), 0)::numeric(18, 2) AS spend,
    COALESCE(SUM(j.total_amount) FILTER (
        WHERE j.payment_status = 'unpaid' AND j.status NOT IN ('cancelled', 'voided')
    ), 0)::numeric(18, 2) AS unpaid_amount,
    MIN(j.started_at)::timestamptz AS first_visit_at,
    MAX(j.started_at)::timestamptz AS last_visit_at
FROM service_jobs j
WHERE j.organization_id = sqlc.arg(organization_id)::bigint
  AND j.customer_id = sqlc.arg(customer_id)::bigint;

-- name: GetCustomerSalesStats :one
SELECT
    COUNT(*)::bigint                                AS sale_count,
    COALESCE(SUM(s.total_amount), 0)::numeric(18, 2) AS spend,
    MAX(s.sold_at)::timestamptz                     AS last_sold_at
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)::bigint
  AND s.customer_id = sqlc.arg(customer_id)::bigint
  AND s.status = 'posted';

-- name: GetCustomerPipelineStats :one
SELECT
    qs.quote_count,
    qs.open_quote_count,
    qs.accepted_quote_count,
    ls.lead_count,
    ls.open_lead_count
FROM (
    SELECT
        COUNT(*)::bigint AS quote_count,
        COUNT(*) FILTER (WHERE q.status IN ('draft', 'sent', 'viewed'))::bigint AS open_quote_count,
        COUNT(*) FILTER (WHERE q.status = 'accepted')::bigint AS accepted_quote_count
    FROM quotes q
    WHERE q.organization_id = sqlc.arg(organization_id)::bigint
      AND q.customer_id = sqlc.arg(customer_id)::bigint
) qs,
(
    SELECT
        COUNT(*)::bigint AS lead_count,
        COUNT(*) FILTER (WHERE ld.status IN ('new', 'contacted', 'quoted'))::bigint AS open_lead_count
    FROM leads ld
    WHERE ld.organization_id = sqlc.arg(organization_id)::bigint
      AND ld.customer_id = sqlc.arg(customer_id)::bigint
) ls;

-- name: ListCustomerMonthlySpend :many
SELECT month::timestamptz AS month,
       SUM(job_amount)::numeric(18, 2)  AS job_amount,
       SUM(sale_amount)::numeric(18, 2) AS sale_amount
FROM (
    SELECT date_trunc('month', j.started_at) AS month,
           j.total_amount AS job_amount,
           0::numeric AS sale_amount
    FROM service_jobs j
    WHERE j.organization_id = sqlc.arg(organization_id)::bigint
      AND j.customer_id = sqlc.arg(customer_id)::bigint
      AND j.status NOT IN ('cancelled', 'voided')
      AND j.started_at >= sqlc.arg(since)::timestamptz
    UNION ALL
    SELECT date_trunc('month', s.sold_at) AS month,
           0::numeric AS job_amount,
           s.total_amount AS sale_amount
    FROM product_sales s
    WHERE s.organization_id = sqlc.arg(organization_id)::bigint
      AND s.customer_id = sqlc.arg(customer_id)::bigint
      AND s.status = 'posted'
      AND s.sold_at >= sqlc.arg(since)::timestamptz
) x
GROUP BY month
ORDER BY month;

-- name: ListCustomerTopServices :many
SELECT
    sv.uuid                                        AS service_uuid,
    l.name,
    COUNT(DISTINCT j.id)::bigint                   AS job_count,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS revenue,
    MAX(j.started_at)::timestamptz                 AS last_used_at
FROM service_job_lines l
JOIN service_jobs j ON j.id = l.job_id AND j.organization_id = l.organization_id
LEFT JOIN services sv ON sv.id = l.service_id AND sv.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND j.customer_id = sqlc.arg(customer_id)::bigint
  AND l.line_type = 'service'
  AND j.status NOT IN ('cancelled', 'voided')
GROUP BY sv.uuid, l.name
ORDER BY job_count DESC, revenue DESC
LIMIT sqlc.arg(limit_count);

-- name: ListCustomerVehicleStats :many
SELECT
    v.uuid                                         AS vehicle_uuid,
    COUNT(j.id)::bigint                            AS job_count,
    COALESCE(SUM(j.total_amount), 0)::numeric(18, 2) AS spend,
    MAX(j.started_at)::timestamptz                 AS last_visit_at
FROM customer_vehicles v
LEFT JOIN service_jobs j
    ON j.vehicle_id = v.id
   AND j.organization_id = v.organization_id
   AND j.status NOT IN ('cancelled', 'voided')
WHERE v.organization_id = sqlc.arg(organization_id)::bigint
  AND v.customer_id = sqlc.arg(customer_id)::bigint
  AND v.deleted_at IS NULL
GROUP BY v.uuid;

-- name: ListCustomerSales :many
SELECT s.uuid, s.status, s.method, s.total_amount, s.currency, s.sold_at,
       (SELECT COUNT(*) FROM product_sale_lines l
         WHERE l.sale_id = s.id AND l.organization_id = s.organization_id)::bigint AS line_count
FROM product_sales s
WHERE s.organization_id = sqlc.arg(organization_id)::bigint
  AND s.customer_id = sqlc.arg(customer_id)::bigint
ORDER BY s.sold_at DESC
LIMIT sqlc.arg(limit_count);

-- ============================================================================
-- Supplier
-- ============================================================================

-- name: GetSupplierPurchaseStats :one
SELECT
    COUNT(*)::bigint                                 AS purchase_count,
    COALESCE(SUM(p.total_amount), 0)::numeric(18, 2) AS spend,
    MIN(p.purchased_at)::timestamptz                 AS first_purchased_at,
    MAX(p.purchased_at)::timestamptz                 AS last_purchased_at,
    (SELECT COUNT(DISTINCT l.product_id)
       FROM purchase_lines l
       JOIN purchases pp ON pp.id = l.purchase_id AND pp.organization_id = l.organization_id
      WHERE l.organization_id = sqlc.arg(organization_id)::bigint
        AND pp.supplier_id = sqlc.arg(supplier_id)::bigint
        AND pp.status = 'posted')::bigint            AS product_count
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)::bigint
  AND p.supplier_id = sqlc.arg(supplier_id)::bigint
  AND p.status = 'posted';

-- name: ListSupplierMonthlySpend :many
SELECT
    date_trunc('month', p.purchased_at)::timestamptz AS month,
    COUNT(*)::bigint                                 AS purchase_count,
    COALESCE(SUM(p.total_amount), 0)::numeric(18, 2) AS spend
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)::bigint
  AND p.supplier_id = sqlc.arg(supplier_id)::bigint
  AND p.status = 'posted'
  AND p.purchased_at >= sqlc.arg(since)::timestamptz
GROUP BY 1
ORDER BY 1;

-- name: ListSupplierTopProducts :many
SELECT
    pr.uuid                                        AS product_uuid,
    pr.name,
    pr.unit,
    COALESCE(SUM(l.qty), 0)::numeric(18, 3)        AS qty,
    COALESCE(SUM(l.line_total), 0)::numeric(18, 2) AS spend,
    MAX(p.purchased_at)::timestamptz               AS last_purchased_at
FROM purchase_lines l
JOIN purchases p ON p.id = l.purchase_id AND p.organization_id = l.organization_id
JOIN products pr ON pr.id = l.product_id AND pr.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg(organization_id)::bigint
  AND p.supplier_id = sqlc.arg(supplier_id)::bigint
  AND p.status = 'posted'
GROUP BY pr.uuid, pr.name, pr.unit
ORDER BY spend DESC
LIMIT sqlc.arg(limit_count);

-- name: ListSupplierPurchases :many
SELECT p.uuid, p.status, p.method, p.total_amount, p.currency, p.purchased_at,
       (SELECT COUNT(*) FROM purchase_lines l
         WHERE l.purchase_id = p.id AND l.organization_id = p.organization_id)::bigint AS line_count
FROM purchases p
WHERE p.organization_id = sqlc.arg(organization_id)::bigint
  AND p.supplier_id = sqlc.arg(supplier_id)::bigint
ORDER BY p.purchased_at DESC
LIMIT sqlc.arg(limit_count);
