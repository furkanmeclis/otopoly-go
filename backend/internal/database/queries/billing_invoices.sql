-- Billing invoices, invoice profiles and seller/XSLT settings.

-- name: NextInvoiceNumber :one
-- Single atomic upsert: row lock on conflict serialises concurrent callers.
INSERT INTO billing_invoice_counters (series, year, last_no)
VALUES (sqlc.arg(series), sqlc.arg(year), 1)
ON CONFLICT (series, year) DO UPDATE SET last_no = billing_invoice_counters.last_no + 1
RETURNING last_no;

-- name: CreateInvoice :one
INSERT INTO billing_invoices (
    uuid, organization_id, order_id, number, issue_date, profile, type, buyer, seller, lines,
    subtotal, discount_total, vat_total, grand_total, xml_object_key, pdf_object_key,
    xslt_version, status, error
) VALUES (
    sqlc.arg(uuid), sqlc.arg(organization_id), sqlc.arg(order_id), sqlc.arg(number),
    sqlc.arg(issue_date), sqlc.arg(profile), sqlc.arg(type), sqlc.arg(buyer), sqlc.arg(seller),
    sqlc.arg(lines), sqlc.arg(subtotal), sqlc.arg(discount_total), sqlc.arg(vat_total),
    sqlc.arg(grand_total), sqlc.arg(xml_object_key), sqlc.arg(pdf_object_key),
    sqlc.arg(xslt_version), sqlc.arg(status), sqlc.arg(error)
)
RETURNING *;

-- name: UpdateInvoiceFiles :one
UPDATE billing_invoices
SET xml_object_key = sqlc.arg(xml_object_key),
    pdf_object_key = sqlc.arg(pdf_object_key),
    xslt_version = sqlc.arg(xslt_version),
    status = sqlc.arg(status),
    error = sqlc.arg(error)
WHERE uuid = sqlc.arg(uuid)
RETURNING *;

-- name: SetInvoiceStatus :one
UPDATE billing_invoices
SET status = sqlc.arg(status),
    error = sqlc.arg(error),
    voided_at = sqlc.narg(voided_at),
    voided_by = sqlc.narg(voided_by)
WHERE uuid = sqlc.arg(uuid)
RETURNING *;

-- name: GetInvoiceByUUID :one
SELECT i.*, o.uuid AS order_uuid, o.reference_code AS order_reference,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
JOIN organizations org ON org.id = i.organization_id
WHERE i.uuid = $1;

-- name: GetInvoiceByUUIDForOrg :one
SELECT i.*, o.uuid AS order_uuid, o.reference_code AS order_reference
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
WHERE i.uuid = sqlc.arg(uuid) AND i.organization_id = sqlc.arg(organization_id);

-- name: GetInvoiceByOrder :one
SELECT i.*, o.uuid AS order_uuid, o.reference_code AS order_reference,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
JOIN organizations org ON org.id = i.organization_id
WHERE i.order_id = $1;

-- name: GetOrderForInvoice :one
SELECT o.*, p.uuid AS plan_uuid, p.code AS plan_code, p.name AS plan_name,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name,
    org.address AS organization_address, org.city AS organization_city,
    org.invoice_name, org.invoice_tax_id, org.invoice_tax_office,
    org.invoice_address, org.invoice_city, org.invoice_email
FROM billing_orders o
JOIN billing_plans p ON p.id = o.plan_id
JOIN organizations org ON org.id = o.organization_id
WHERE o.id = $1;

-- name: ListInvoicesForOrg :many
SELECT i.*, o.uuid AS order_uuid, o.reference_code AS order_reference
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
WHERE i.organization_id = sqlc.arg(organization_id)
ORDER BY i.created_at DESC, i.id DESC
LIMIT sqlc.arg(limit_) OFFSET sqlc.arg(offset_);

-- name: CountInvoicesForOrg :one
SELECT COUNT(*)::bigint FROM billing_invoices WHERE organization_id = $1;

-- name: ListInvoices :many
SELECT i.*, o.uuid AS order_uuid, o.reference_code AS order_reference,
    org.uuid AS organization_uuid, org.slug AS organization_slug, org.name AS organization_name
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
JOIN organizations org ON org.id = i.organization_id
WHERE (sqlc.arg(status)::text = '' OR i.status = sqlc.arg(status)::text)
    AND (
        sqlc.arg(q)::text = ''
        OR i.number ILIKE '%' || sqlc.arg(q)::text || '%'
        OR o.reference_code ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.name ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.slug ILIKE '%' || sqlc.arg(q)::text || '%'
    )
ORDER BY i.created_at DESC, i.id DESC
LIMIT sqlc.arg(limit_) OFFSET sqlc.arg(offset_);

-- name: CountInvoices :one
SELECT COUNT(*)::bigint
FROM billing_invoices i
JOIN billing_orders o ON o.id = i.order_id
JOIN organizations org ON org.id = i.organization_id
WHERE (sqlc.arg(status)::text = '' OR i.status = sqlc.arg(status)::text)
    AND (
        sqlc.arg(q)::text = ''
        OR i.number ILIKE '%' || sqlc.arg(q)::text || '%'
        OR o.reference_code ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.name ILIKE '%' || sqlc.arg(q)::text || '%'
        OR org.slug ILIKE '%' || sqlc.arg(q)::text || '%'
    );

-- name: GetInvoiceProfile :one
SELECT invoice_name, invoice_tax_id, invoice_tax_office, invoice_address, invoice_city, invoice_email
FROM organizations
WHERE id = $1 AND deleted_at IS NULL;

-- name: UpdateInvoiceProfile :one
UPDATE organizations
SET invoice_name = sqlc.arg(invoice_name),
    invoice_tax_id = sqlc.arg(invoice_tax_id),
    invoice_tax_office = sqlc.arg(invoice_tax_office),
    invoice_address = sqlc.arg(invoice_address),
    invoice_city = sqlc.arg(invoice_city),
    invoice_email = sqlc.arg(invoice_email)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING invoice_name, invoice_tax_id, invoice_tax_office, invoice_address, invoice_city, invoice_email;

-- name: GetSellerSettings :one
SELECT seller_name, seller_tax_id, seller_tax_office, seller_address, seller_city,
    seller_email, seller_phone, seller_website, invoice_series, xslt_object_key, xslt_uploaded_at
FROM billing_settings
WHERE id = 1;

-- name: UpdateSellerSettings :one
UPDATE billing_settings
SET seller_name = sqlc.arg(seller_name),
    seller_tax_id = sqlc.arg(seller_tax_id),
    seller_tax_office = sqlc.arg(seller_tax_office),
    seller_address = sqlc.arg(seller_address),
    seller_city = sqlc.arg(seller_city),
    seller_email = sqlc.arg(seller_email),
    seller_phone = sqlc.arg(seller_phone),
    seller_website = sqlc.arg(seller_website),
    invoice_series = sqlc.arg(invoice_series)
WHERE id = 1
RETURNING seller_name, seller_tax_id, seller_tax_office, seller_address, seller_city,
    seller_email, seller_phone, seller_website, invoice_series, xslt_object_key, xslt_uploaded_at;

-- name: SetXSLT :one
UPDATE billing_settings
SET xslt_object_key = sqlc.arg(xslt_object_key),
    xslt_uploaded_at = sqlc.narg(xslt_uploaded_at)
WHERE id = 1
RETURNING seller_name, seller_tax_id, seller_tax_office, seller_address, seller_city,
    seller_email, seller_phone, seller_website, invoice_series, xslt_object_key, xslt_uploaded_at;
