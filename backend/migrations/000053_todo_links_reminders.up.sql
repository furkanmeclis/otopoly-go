-- Todos: lead/quote links and early-reminder offsets.
--
-- lead_id / quote_id intentionally have NO foreign keys here: the leads and
-- quotes tables are created by the Leads & Quotes migration, which adds
--   ALTER TABLE todos ADD CONSTRAINT fk_todos_lead  FOREIGN KEY (lead_id)  REFERENCES leads (id)  ON DELETE SET NULL;
--   ALTER TABLE todos ADD CONSTRAINT fk_todos_quote FOREIGN KEY (quote_id) REFERENCES quotes (id) ON DELETE SET NULL;
ALTER TABLE todos
    ADD COLUMN lead_id          BIGINT,
    ADD COLUMN quote_id         BIGINT,
    -- Minutes before the due moment (0 = at due time). Reminder rows live in
    -- scheduled_notifications (subject_type = 'todo').
    ADD COLUMN reminder_offsets INTEGER[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT chk_todos_reminder_offsets CHECK (
        cardinality(reminder_offsets) <= 5
        AND 0 <= ALL (reminder_offsets)
        AND 43200 >= ALL (reminder_offsets)
    ),
    ADD CONSTRAINT chk_todos_reminders_need_due CHECK (
        cardinality(reminder_offsets) = 0 OR due_date IS NOT NULL
    );

CREATE INDEX idx_todos_org_customer ON todos (organization_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_todos_org_lead ON todos (organization_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_todos_org_quote ON todos (organization_id, quote_id) WHERE quote_id IS NOT NULL;
