-- AI assistant (phase 2): confirmable actions, todos, and permissions.

-- A write-tool call proposed by the assistant and waiting for the user.
-- input:   validated, reference-resolved tool input (what runs on confirm).
-- preview: the confirm card shown to the user (fields, editable fields).
-- status:  pending → executing → confirmed | failed; pending → cancelled | expired.
--          The pending → executing transition is the idempotency lock: only one
--          confirm request can win it.
CREATE TABLE ai_pending_actions (
    id              BIGSERIAL    PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    conversation_id BIGINT       NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
    -- The assistant message holding the tool_use (set when the turn is persisted).
    message_id      BIGINT       REFERENCES ai_messages (id) ON DELETE SET NULL,
    tool_use_id     VARCHAR(128) NOT NULL,
    tool_name       VARCHAR(64)  NOT NULL,
    input           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    preview         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    result          JSONB,
    error           TEXT         NOT NULL DEFAULT '',
    idempotency_key VARCHAR(200) NOT NULL,
    expires_at      TIMESTAMPTZ  NOT NULL,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_ai_pending_actions_uuid UNIQUE (uuid),
    CONSTRAINT uq_ai_pending_actions_idempotency UNIQUE (idempotency_key),
    CONSTRAINT chk_ai_pending_actions_status CHECK (
        status IN ('pending', 'executing', 'confirmed', 'cancelled', 'expired', 'failed')
    )
);

CREATE INDEX idx_ai_pending_actions_conversation_pending
    ON ai_pending_actions (conversation_id)
    WHERE status = 'pending';

CREATE TRIGGER trg_ai_pending_actions_updated_at
    BEFORE UPDATE ON ai_pending_actions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Organization todos (görevler). Created from the UI or by the assistant.
CREATE TABLE todos (
    id                BIGSERIAL    PRIMARY KEY,
    uuid              UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id   BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    title             VARCHAR(200) NOT NULL,
    notes             TEXT         NOT NULL DEFAULT '',
    due_date          DATE,
    -- Optional time of day (local, Europe/Istanbul); only meaningful with due_date.
    due_time          TIME,
    assignee_user_id  BIGINT       REFERENCES users (id) ON DELETE SET NULL,
    customer_id       BIGINT       REFERENCES customers (id) ON DELETE SET NULL,
    service_job_id    BIGINT       REFERENCES service_jobs (id) ON DELETE SET NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'open',
    completed_at      TIMESTAMPTZ,
    completed_by      BIGINT       REFERENCES users (id) ON DELETE SET NULL,
    created_by        BIGINT       REFERENCES users (id) ON DELETE SET NULL,
    via_ai            BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_todos_uuid UNIQUE (uuid),
    CONSTRAINT chk_todos_status CHECK (status IN ('open', 'done')),
    CONSTRAINT chk_todos_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT chk_todos_due_time CHECK (due_time IS NULL OR due_date IS NOT NULL)
);

CREATE INDEX idx_todos_org_open_due
    ON todos (organization_id, due_date NULLS LAST, due_time NULLS LAST)
    WHERE status = 'open';

CREATE INDEX idx_todos_org_created ON todos (organization_id, created_at DESC);

CREATE TRIGGER trg_todos_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions.
INSERT INTO permissions (name, slug) VALUES
    ('Read tenant todos', 'tenant.todos.read'),
    ('Write tenant todos', 'tenant.todos.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.todos.read', 'tenant.todos.write')
WHERE r.slug IN ('organization_owner', 'organization_user', 'super_admin')
ON CONFLICT DO NOTHING;

-- Staff may use the assistant too; its tools are filtered by the user's own
-- permissions and write tools always require confirmation.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.ai.use'
WHERE r.slug = 'organization_user'
ON CONFLICT DO NOTHING;
