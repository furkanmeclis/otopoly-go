DROP INDEX IF EXISTS idx_service_jobs_org_delivered_at;
ALTER TABLE service_jobs DROP COLUMN IF EXISTS delivered_at;
