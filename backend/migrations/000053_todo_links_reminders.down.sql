-- Removes todo lead/quote links and reminder offsets (data loss for those columns).
DROP INDEX IF EXISTS idx_todos_org_quote;
DROP INDEX IF EXISTS idx_todos_org_lead;
DROP INDEX IF EXISTS idx_todos_org_customer;
ALTER TABLE todos
    DROP CONSTRAINT IF EXISTS chk_todos_reminders_need_due,
    DROP CONSTRAINT IF EXISTS chk_todos_reminder_offsets,
    DROP COLUMN IF EXISTS reminder_offsets,
    DROP COLUMN IF EXISTS quote_id,
    DROP COLUMN IF EXISTS lead_id;
