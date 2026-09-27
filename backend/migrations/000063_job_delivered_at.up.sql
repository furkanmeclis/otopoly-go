-- When the car was handed over; lets a multi-day job show up among the
-- day's delivered cars instead of only on the day it was opened.
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL;

UPDATE service_jobs
SET delivered_at = COALESCE(paid_at, completed_at, updated_at)
WHERE status = 'delivered' AND delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_jobs_org_delivered_at
    ON service_jobs (organization_id, delivered_at) WHERE delivered_at IS NOT NULL;
