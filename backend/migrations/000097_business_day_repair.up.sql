-- Business-day repair (Europe/Istanbul).
--
-- Until this release the API wrote the DATE of automatic finance / cari
-- entries from the server clock or a UTC instant, and production runs in
-- UTC. A job closed, a product sold or a stock purchase recorded between
-- 00:00 and 03:00 Türkiye time was therefore dated the previous day.
--
-- This migration re-dates ONLY rows whose date the system derived itself:
-- entries owned by a source document (service_job, product_sale, purchase).
-- Those rows cannot be edited by people (finance correct / void go through
-- the source document), so their date always equals the calendar day of the
-- source instant:
--   service_job  -> service_job_payments.created_at (the close / payment)
--   product_sale -> product_sales.sold_at
--   purchase     -> purchases.purchased_at
-- A row changes only when its date equals the UTC day of that instant AND
-- differs from the Europe/Istanbul day; it is set to the Istanbul day.
-- Rows with a user-chosen date (manual entries, cari_payment collections,
-- charges / payments typed in the panel or app) are never touched, and
-- loyalty sources already used the Istanbul day.
--
-- Deterministic and idempotent: a second run finds nothing to change.
-- Read-only preview: docs/business-timezone.md.

-- Finance transactions
UPDATE finance_transactions t
SET transaction_date = (p.created_at AT TIME ZONE 'Europe/Istanbul')::date,
    updated_at = NOW()
FROM service_job_payments p
WHERE t.source_type = 'service_job'
  AND t.source_uuid = p.uuid
  AND t.organization_id = p.organization_id
  AND t.transaction_date = (p.created_at AT TIME ZONE 'UTC')::date
  AND t.transaction_date <> (p.created_at AT TIME ZONE 'Europe/Istanbul')::date;

UPDATE finance_transactions t
SET transaction_date = (s.sold_at AT TIME ZONE 'Europe/Istanbul')::date,
    updated_at = NOW()
FROM product_sales s
WHERE t.source_type = 'product_sale'
  AND t.source_uuid = s.uuid
  AND t.organization_id = s.organization_id
  AND t.transaction_date = (s.sold_at AT TIME ZONE 'UTC')::date
  AND t.transaction_date <> (s.sold_at AT TIME ZONE 'Europe/Istanbul')::date;

UPDATE finance_transactions t
SET transaction_date = (pu.purchased_at AT TIME ZONE 'Europe/Istanbul')::date,
    updated_at = NOW()
FROM purchases pu
WHERE t.source_type = 'purchase'
  AND t.source_uuid = pu.uuid
  AND t.organization_id = pu.organization_id
  AND t.transaction_date = (pu.purchased_at AT TIME ZONE 'UTC')::date
  AND t.transaction_date <> (pu.purchased_at AT TIME ZONE 'Europe/Istanbul')::date;

-- Cari entries (job closed / sale made on account)
UPDATE cari_entries e
SET entry_date = (p.created_at AT TIME ZONE 'Europe/Istanbul')::date,
    updated_at = NOW()
FROM service_job_payments p
WHERE e.source_type = 'service_job'
  AND e.source_uuid = p.uuid
  AND e.organization_id = p.organization_id
  AND e.entry_date = (p.created_at AT TIME ZONE 'UTC')::date
  AND e.entry_date <> (p.created_at AT TIME ZONE 'Europe/Istanbul')::date;

UPDATE cari_entries e
SET entry_date = (s.sold_at AT TIME ZONE 'Europe/Istanbul')::date,
    updated_at = NOW()
FROM product_sales s
WHERE e.source_type = 'product_sale'
  AND e.source_uuid = s.uuid
  AND e.organization_id = s.organization_id
  AND e.entry_date = (s.sold_at AT TIME ZONE 'UTC')::date
  AND e.entry_date <> (s.sold_at AT TIME ZONE 'Europe/Istanbul')::date;
