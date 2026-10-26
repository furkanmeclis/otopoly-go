-- Stock reorder suggestions. Every query is scoped by organization_id.

-- name: GetStockReorderSettings :one
SELECT * FROM stock_reorder_settings
WHERE organization_id = $1;

-- name: UpsertStockReorderSettings :one
INSERT INTO stock_reorder_settings (organization_id, velocity_days, lead_days, target_days, notify_enabled)
VALUES (sqlc.arg(organization_id), sqlc.arg(velocity_days), sqlc.arg(lead_days), sqlc.arg(target_days), sqlc.arg(notify_enabled))
ON CONFLICT (organization_id) DO UPDATE
SET velocity_days = EXCLUDED.velocity_days,
    lead_days = EXCLUDED.lead_days,
    target_days = EXCLUDED.target_days,
    notify_enabled = EXCLUDED.notify_enabled
RETURNING *;

-- name: ListStockReorderNotifyOrganizations :many
-- Organizations whose daily reorder notification is on: an explicit row
-- with notify_enabled, or no row at all (default on) for organizations that
-- track stock on at least one active product.
SELECT o.id AS organization_id,
       o.uuid AS organization_uuid,
       o.slug AS organization_slug,
       s.last_notified_on
FROM organizations o
LEFT JOIN stock_reorder_settings s ON s.organization_id = o.id
WHERE o.status = 'active'
  AND COALESCE(s.notify_enabled, TRUE)
  AND (s.last_notified_on IS NULL OR s.last_notified_on < sqlc.arg(day)::date)
  AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.organization_id = o.id
        AND p.track_stock AND p.is_active AND p.deleted_at IS NULL
  )
ORDER BY o.id;

-- name: ClaimStockReorderNotification :execrows
-- Marks today's notification as sent (creates the settings row with defaults
-- when missing); 0 rows when another sweep already claimed the day.
INSERT INTO stock_reorder_settings (organization_id, last_notified_on)
VALUES (sqlc.arg(organization_id), sqlc.arg(day)::date)
ON CONFLICT (organization_id) DO UPDATE
SET last_notified_on = EXCLUDED.last_notified_on
WHERE stock_reorder_settings.notify_enabled
  AND (stock_reorder_settings.last_notified_on IS NULL
       OR stock_reorder_settings.last_notified_on < EXCLUDED.last_notified_on);

-- name: ListStockReorderSupplierSettings :many
SELECT ss.supplier_id, ss.lead_days, s.uuid AS supplier_uuid, s.name AS supplier_name
FROM stock_reorder_supplier_settings ss
JOIN suppliers s ON s.id = ss.supplier_id AND s.organization_id = ss.organization_id
WHERE ss.organization_id = $1
  AND s.deleted_at IS NULL
ORDER BY lower(s.name);

-- name: UpsertStockReorderSupplierSetting :exec
INSERT INTO stock_reorder_supplier_settings (organization_id, supplier_id, lead_days)
VALUES (sqlc.arg(organization_id), sqlc.arg(supplier_id), sqlc.arg(lead_days))
ON CONFLICT (supplier_id) DO UPDATE
SET lead_days = EXCLUDED.lead_days
WHERE stock_reorder_supplier_settings.organization_id = EXCLUDED.organization_id;

-- name: DeleteStockReorderSupplierSetting :exec
DELETE FROM stock_reorder_supplier_settings
WHERE organization_id = $1 AND supplier_id = $2;

-- name: GetStockReorderProductSetting :one
SELECT ps.*, s.uuid AS supplier_uuid, s.name AS supplier_name
FROM stock_reorder_product_settings ps
LEFT JOIN suppliers s ON s.id = ps.supplier_id AND s.organization_id = ps.organization_id
WHERE ps.organization_id = $1 AND ps.product_id = $2;

-- name: UpsertStockReorderProductSetting :exec
INSERT INTO stock_reorder_product_settings (organization_id, product_id, supplier_id, lead_days, target_days, pack_size)
VALUES (sqlc.arg(organization_id), sqlc.arg(product_id), sqlc.narg(supplier_id), sqlc.narg(lead_days), sqlc.narg(target_days), sqlc.narg(pack_size))
ON CONFLICT (product_id) DO UPDATE
SET supplier_id = EXCLUDED.supplier_id,
    lead_days = EXCLUDED.lead_days,
    target_days = EXCLUDED.target_days,
    pack_size = EXCLUDED.pack_size
WHERE stock_reorder_product_settings.organization_id = EXCLUDED.organization_id;

-- name: DeleteStockReorderProductSetting :exec
DELETE FROM stock_reorder_product_settings
WHERE organization_id = $1 AND product_id = $2;

-- name: ListStockReorderCandidates :many
-- One row per active stock-tracked product with every input of the reorder
-- formula: stock, min, consumption (job consumptions not reverted) and sales
-- (posted) since `since`, quantity on open draft purchases, the product
-- overrides, the preferred supplier (override, else the latest posted
-- purchase's supplier) with its lead time and the last unit cost.
WITH consumed AS (
    SELECT c.product_id, SUM(c.qty)::numeric AS qty
    FROM service_job_consumptions c
    WHERE c.organization_id = sqlc.arg(organization_id)
      AND c.reverted_at IS NULL
      AND c.created_at >= sqlc.arg(since)::timestamptz
    GROUP BY c.product_id
),
sold AS (
    SELECT l.product_id, SUM(l.qty)::numeric AS qty
    FROM product_sale_lines l
    JOIN product_sales s ON s.id = l.sale_id AND s.organization_id = l.organization_id
    WHERE l.organization_id = sqlc.arg(organization_id)
      AND s.status = 'posted'
      AND s.sold_at >= sqlc.arg(since)::timestamptz
    GROUP BY l.product_id
),
on_order AS (
    SELECT l.product_id, SUM(l.qty)::numeric AS qty
    FROM purchase_lines l
    JOIN purchases p ON p.id = l.purchase_id AND p.organization_id = l.organization_id
    WHERE l.organization_id = sqlc.arg(organization_id)
      AND p.status = 'draft'
    GROUP BY l.product_id
),
last_purchase AS (
    SELECT DISTINCT ON (l.product_id)
           l.product_id, p.supplier_id, l.unit_cost, p.purchased_at
    FROM purchase_lines l
    JOIN purchases p ON p.id = l.purchase_id AND p.organization_id = l.organization_id
    WHERE l.organization_id = sqlc.arg(organization_id)
      AND p.status = 'posted'
    ORDER BY l.product_id, p.purchased_at DESC, l.id DESC
)
SELECT pr.id,
       pr.uuid,
       pr.name,
       COALESCE(pr.sku, '')::text AS sku,
       pr.unit,
       pr.currency,
       pr.cost_price,
       pr.stock_quantity,
       pr.min_stock_alert,
       COALESCE(consumed.qty, 0)::numeric AS consumed_qty,
       COALESCE(sold.qty, 0)::numeric AS sold_qty,
       COALESCE(on_order.qty, 0)::numeric AS on_order_qty,
       ps.lead_days AS product_lead_days,
       ps.target_days AS product_target_days,
       ps.pack_size,
       (ps.supplier_id IS NOT NULL AND es.id IS NOT NULL)::boolean AS supplier_is_override,
       es.uuid AS supplier_uuid,
       es.name AS supplier_name,
       ss.lead_days AS supplier_lead_days,
       lp.unit_cost AS last_unit_cost,
       lp.purchased_at AS last_purchased_at,
       (lp.supplier_id IS NOT NULL AND lp.supplier_id = es.id)::boolean AS last_cost_from_supplier
FROM products pr
LEFT JOIN consumed ON consumed.product_id = pr.id
LEFT JOIN sold ON sold.product_id = pr.id
LEFT JOIN on_order ON on_order.product_id = pr.id
LEFT JOIN last_purchase lp ON lp.product_id = pr.id
LEFT JOIN stock_reorder_product_settings ps
       ON ps.product_id = pr.id AND ps.organization_id = pr.organization_id
LEFT JOIN suppliers es
       ON es.id = COALESCE(ps.supplier_id, lp.supplier_id)
      AND es.organization_id = pr.organization_id
      AND es.deleted_at IS NULL
LEFT JOIN stock_reorder_supplier_settings ss
       ON ss.supplier_id = es.id AND ss.organization_id = pr.organization_id
WHERE pr.organization_id = sqlc.arg(organization_id)
  AND pr.track_stock
  AND pr.is_active
  AND pr.deleted_at IS NULL
  AND (sqlc.narg(product_ids)::bigint[] IS NULL OR pr.id = ANY (sqlc.narg(product_ids)::bigint[]))
ORDER BY lower(pr.name), pr.id;

-- name: ListStockReorderNotifyRecipients :many
-- Active members who may place purchases (tenant.purchases.write).
SELECT u.id AS user_id
FROM organization_members om
JOIN users u ON u.id = om.user_id
WHERE om.organization_id = $1
  AND u.status = 'active'
  AND EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = u.id AND p.slug = 'tenant.purchases.write'
  )
ORDER BY (om.role = 'owner') DESC, u.id
LIMIT 50;
