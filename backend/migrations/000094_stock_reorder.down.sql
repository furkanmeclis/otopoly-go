-- Reverts stock reorder suggestions. Data loss: reorder settings, supplier
-- lead times, product overrides, every DRAFT purchase (with its lines) and
-- the stock_reorder.enabled plan values are removed.
DELETE FROM billing_plan_features
WHERE feature_id IN (SELECT id FROM billing_features WHERE key = 'stock_reorder.enabled');
DELETE FROM billing_features WHERE key = 'stock_reorder.enabled';

DROP INDEX IF EXISTS idx_service_job_consumptions_org_product_created;
DROP TABLE IF EXISTS stock_reorder_product_settings;
DROP TABLE IF EXISTS stock_reorder_supplier_settings;
DROP TABLE IF EXISTS stock_reorder_settings;

DROP INDEX IF EXISTS idx_purchases_org_drafts;
DELETE FROM purchases WHERE status = 'draft';
ALTER TABLE purchases DROP CONSTRAINT chk_purchases_total;
ALTER TABLE purchases ADD CONSTRAINT chk_purchases_total CHECK (total_amount > 0);
ALTER TABLE purchases DROP CONSTRAINT chk_purchases_status;
ALTER TABLE purchases ADD CONSTRAINT chk_purchases_status CHECK (status IN ('posted', 'voided'));
