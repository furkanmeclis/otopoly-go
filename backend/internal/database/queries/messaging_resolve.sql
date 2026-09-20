-- name: GetJobOrgAndPhoneByUUID :one
SELECT j.organization_id,
       j.customer_phone,
       j.customer_name,
       j.plate,
       j.uuid::text AS job_uuid,
       (j.total_amount)::text AS total_amount,
       j.currency,
       o.name AS business_name
FROM service_jobs j
JOIN organizations o ON o.id = j.organization_id
WHERE j.uuid = $1;

-- name: GetSaleOrgAndPhoneByUUID :one
SELECT s.organization_id,
       s.customer_phone,
       COALESCE(s.customer_name, '') AS customer_name,
       s.uuid::text AS sale_uuid,
       (s.total_amount)::text AS total_amount,
       s.currency,
       o.name AS business_name
FROM product_sales s
JOIN organizations o ON o.id = s.organization_id
WHERE s.uuid = $1;

-- name: GetContractInstanceMessagingByUUID :one
SELECT ci.organization_id,
       ci.uuid::text AS instance_uuid,
       ci.title AS contract_title,
       ci.subject_type,
       ci.subject_uuid,
       o.name AS business_name
FROM contract_instances ci
JOIN organizations o ON o.id = ci.organization_id
WHERE ci.uuid = $1;
