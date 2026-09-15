DROP INDEX IF EXISTS uq_contract_instances_org_number;

ALTER TABLE contract_instances
    DROP COLUMN IF EXISTS number,
    DROP COLUMN IF EXISTS locale;
