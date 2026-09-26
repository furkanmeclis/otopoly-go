DELETE FROM message_template_defaults WHERE event_type IN ('quote.team_created', 'quote.team_expiring');

DROP INDEX IF EXISTS idx_quote_reminders_external_ref;
DROP INDEX IF EXISTS idx_quote_deliveries_provider_ref;

-- idx_todos_org_lead / idx_todos_org_quote belong to 000053 and are kept.
ALTER TABLE todos
    DROP CONSTRAINT IF EXISTS fk_todos_quote,
    DROP CONSTRAINT IF EXISTS fk_todos_lead;
