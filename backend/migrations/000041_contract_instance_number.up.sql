ALTER TABLE contract_instances
    ADD COLUMN number INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN locale VARCHAR(8) NOT NULL DEFAULT 'tr';

WITH numbered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY organization_id
               ORDER BY created_at ASC, id ASC
           )::int AS n
    FROM contract_instances
)
UPDATE contract_instances ci
SET number = numbered.n
FROM numbered
WHERE ci.id = numbered.id;

ALTER TABLE contract_instances
    ALTER COLUMN number DROP DEFAULT;

CREATE UNIQUE INDEX uq_contract_instances_org_number
    ON contract_instances (organization_id, number);
