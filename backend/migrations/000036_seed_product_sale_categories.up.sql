-- Backfill income/expense categories used by product sales and stock purchases.
INSERT INTO finance_categories (organization_id, name, kind, sort_order, is_active)
SELECT DISTINCT fc.organization_id, 'Ürün Satışı', 'income', 2, true
FROM finance_categories fc
WHERE fc.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM finance_categories x
      WHERE x.organization_id = fc.organization_id
        AND x.deleted_at IS NULL
        AND lower(x.name) = lower('Ürün Satışı')
        AND x.kind = 'income'
  );

INSERT INTO finance_categories (organization_id, name, kind, sort_order, is_active)
SELECT DISTINCT fc.organization_id, 'Stok Alımı', 'expense', 4, true
FROM finance_categories fc
WHERE fc.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM finance_categories x
      WHERE x.organization_id = fc.organization_id
        AND x.deleted_at IS NULL
        AND lower(x.name) = lower('Stok Alımı')
        AND x.kind = 'expense'
  );
