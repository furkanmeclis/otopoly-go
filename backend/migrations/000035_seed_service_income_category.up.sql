-- Seed "Hizmet Geliri" for orgs that already have finance but lack this category
-- (e.g. category deleted, or org created before seed list / jobs module).
INSERT INTO finance_categories (organization_id, name, kind, sort_order, is_active)
SELECT DISTINCT fc.organization_id, 'Hizmet Geliri', 'income', 1, true
FROM finance_categories fc
WHERE fc.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM finance_categories x
      WHERE x.organization_id = fc.organization_id
        AND x.deleted_at IS NULL
        AND lower(x.name) = lower('Hizmet Geliri')
  );
