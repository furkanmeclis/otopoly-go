DROP TABLE IF EXISTS billing_invoices;
DROP TABLE IF EXISTS billing_invoice_counters;

ALTER TABLE billing_settings
    DROP COLUMN IF EXISTS xslt_uploaded_at;

ALTER TABLE organizations
    DROP COLUMN IF EXISTS invoice_email,
    DROP COLUMN IF EXISTS invoice_city,
    DROP COLUMN IF EXISTS invoice_address,
    DROP COLUMN IF EXISTS invoice_tax_office,
    DROP COLUMN IF EXISTS invoice_tax_id,
    DROP COLUMN IF EXISTS invoice_name;
