ALTER TABLE customers
    DROP COLUMN IF EXISTS tax_office,
    DROP COLUMN IF EXISTS tax_id;
