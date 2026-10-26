-- Organization calendar: the business's own events. Module data (jobs, todos,
-- quotes, leads, sales, …) is read live into the calendar feed, not copied here.
CREATE TABLE calendar_events (
    id              BIGSERIAL PRIMARY KEY,
    uuid            UUID         NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT         NOT NULL DEFAULT '',
    location        VARCHAR(200) NOT NULL DEFAULT '',
    starts_at       TIMESTAMPTZ  NOT NULL,
    ends_at         TIMESTAMPTZ  NOT NULL,
    all_day         BOOLEAN      NOT NULL DEFAULT false,
    color           VARCHAR(16)  NOT NULL DEFAULT 'blue',
    created_by      BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ  NULL,
    CONSTRAINT uq_calendar_events_uuid UNIQUE (uuid),
    CONSTRAINT chk_calendar_events_range CHECK (ends_at > starts_at),
    CONSTRAINT chk_calendar_events_color CHECK (
        color IN ('blue', 'emerald', 'amber', 'rose', 'violet', 'sky', 'orange', 'teal', 'pink', 'slate')
    )
);

CREATE INDEX idx_calendar_events_org_range
    ON calendar_events (organization_id, starts_at, ends_at)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_calendar_events_set_updated_at
    BEFORE UPDATE ON calendar_events
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Owners and staff read and write the calendar. Each module layer in the
-- feed is still filtered by that module's own read permission (finance,
-- sales, quotes, …), so the calendar never widens what a member can see.
INSERT INTO permissions (name, slug) VALUES
    ('Read tenant calendar', 'tenant.calendar.read'),
    ('Write tenant calendar', 'tenant.calendar.write')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('tenant.calendar.read', 'tenant.calendar.write')
WHERE r.slug IN ('organization_owner', 'organization_user', 'super_admin')
ON CONFLICT DO NOTHING;
