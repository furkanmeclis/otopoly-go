-- name: GetJobOrgAndPhoneByUUID :one
SELECT organization_id, customer_phone FROM service_jobs WHERE uuid = $1;

-- name: GetSaleOrgAndPhoneByUUID :one
SELECT organization_id, customer_phone FROM product_sales WHERE uuid = $1;
