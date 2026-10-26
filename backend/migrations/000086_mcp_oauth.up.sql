-- Remote MCP server with OAuth 2.1 (docs/MCP.md).
--
-- Two protected resources (RFC 8707 audiences), each a Streamable HTTP MCP
-- endpoint:
--   * /mcp/org       business tools in the one organization chosen on consent
--                    (organization_id set), with the member's permissions;
--   * /mcp/platform  platform admin tools (organization_id NULL), with the
--                    user's platform permissions.
--
-- Tables (all prefixed mcp_oauth_, the login OAuth tables are unrelated):
--   * mcp_oauth_clients: RFC 7591 dynamic registrations (public clients only).
--     revoked_at blocks the client (platform admin).
--   * mcp_oauth_auth_requests: a validated /oauth/authorize request waiting
--     for consent (15 minutes).
--   * mcp_oauth_grants: the user's connected apps, one row per user + client +
--     resource + organization, created on consent.
--   * mcp_oauth_codes: authorization codes (SHA-256, 5 minutes, PKCE S256).
--     used_at + family let a replayed code revoke what it issued.
--   * mcp_oauth_tokens: access (1 hour) and refresh (30 days) tokens as
--     SHA-256. One code exchange = one family; refresh rotation keeps the
--     family and reuse of a rotated refresh token revokes the family.

CREATE TABLE mcp_oauth_clients (
    id            BIGSERIAL     PRIMARY KEY,
    uuid          UUID          NOT NULL DEFAULT gen_random_uuid(),
    client_id     VARCHAR(64)   NOT NULL,
    client_name   VARCHAR(200)  NOT NULL,
    redirect_uris TEXT[]        NOT NULL,
    created_ip    VARCHAR(64)   NULL,
    last_used_at  TIMESTAMPTZ   NULL,
    revoked_at    TIMESTAMPTZ   NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mcp_oauth_clients_uuid UNIQUE (uuid),
    CONSTRAINT uq_mcp_oauth_clients_client_id UNIQUE (client_id),
    CONSTRAINT chk_mcp_oauth_clients_redirect_uris CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10)
);

CREATE INDEX idx_mcp_oauth_clients_created_at ON mcp_oauth_clients (created_at);

CREATE TABLE mcp_oauth_auth_requests (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      VARCHAR(64)   NOT NULL REFERENCES mcp_oauth_clients (client_id) ON DELETE CASCADE,
    redirect_uri   TEXT          NOT NULL,
    code_challenge VARCHAR(128)  NOT NULL,
    state          TEXT          NULL,
    scopes         TEXT[]        NOT NULL,
    resource       VARCHAR(32)   NOT NULL,
    expires_at     TIMESTAMPTZ   NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_mcp_oauth_auth_requests_resource CHECK (resource IN ('/mcp/org', '/mcp/platform'))
);

CREATE INDEX idx_mcp_oauth_auth_requests_expires ON mcp_oauth_auth_requests (expires_at);

CREATE TABLE mcp_oauth_grants (
    id              BIGSERIAL     PRIMARY KEY,
    uuid            UUID          NOT NULL DEFAULT gen_random_uuid(),
    user_id         BIGINT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_id       VARCHAR(64)   NOT NULL REFERENCES mcp_oauth_clients (client_id) ON DELETE CASCADE,
    organization_id BIGINT        NULL REFERENCES organizations (id) ON DELETE CASCADE,
    resource        VARCHAR(32)   NOT NULL,
    scopes          TEXT[]        NOT NULL,
    last_used_at    TIMESTAMPTZ   NULL,
    revoked_at      TIMESTAMPTZ   NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mcp_oauth_grants_uuid UNIQUE (uuid),
    CONSTRAINT uq_mcp_oauth_grants_key UNIQUE NULLS NOT DISTINCT (user_id, client_id, resource, organization_id),
    CONSTRAINT chk_mcp_oauth_grants_resource CHECK (resource IN ('/mcp/org', '/mcp/platform')),
    CONSTRAINT chk_mcp_oauth_grants_org CHECK ((resource = '/mcp/org') = (organization_id IS NOT NULL))
);

CREATE INDEX idx_mcp_oauth_grants_user ON mcp_oauth_grants (user_id);
CREATE INDEX idx_mcp_oauth_grants_client ON mcp_oauth_grants (client_id);
CREATE INDEX idx_mcp_oauth_grants_organization ON mcp_oauth_grants (organization_id);

CREATE TRIGGER trg_mcp_oauth_grants_set_updated_at
    BEFORE UPDATE ON mcp_oauth_grants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mcp_oauth_codes (
    code_hash       VARCHAR(64)   PRIMARY KEY,
    grant_id        BIGINT        NOT NULL REFERENCES mcp_oauth_grants (id) ON DELETE CASCADE,
    client_id       VARCHAR(64)   NOT NULL REFERENCES mcp_oauth_clients (client_id) ON DELETE CASCADE,
    user_id         BIGINT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id BIGINT        NULL REFERENCES organizations (id) ON DELETE CASCADE,
    redirect_uri    TEXT          NOT NULL,
    code_challenge  VARCHAR(128)  NOT NULL,
    resource        VARCHAR(32)   NOT NULL,
    scopes          TEXT[]        NOT NULL,
    expires_at      TIMESTAMPTZ   NOT NULL,
    used_at         TIMESTAMPTZ   NULL,
    family          UUID          NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_mcp_oauth_codes_resource CHECK (resource IN ('/mcp/org', '/mcp/platform')),
    CONSTRAINT chk_mcp_oauth_codes_used CHECK ((used_at IS NULL) = (family IS NULL))
);

CREATE INDEX idx_mcp_oauth_codes_expires ON mcp_oauth_codes (expires_at);
CREATE INDEX idx_mcp_oauth_codes_grant ON mcp_oauth_codes (grant_id);

CREATE TABLE mcp_oauth_tokens (
    id              BIGSERIAL     PRIMARY KEY,
    token_hash      VARCHAR(64)   NOT NULL,
    kind            VARCHAR(10)   NOT NULL,
    family          UUID          NOT NULL,
    grant_id        BIGINT        NOT NULL REFERENCES mcp_oauth_grants (id) ON DELETE CASCADE,
    client_id       VARCHAR(64)   NOT NULL REFERENCES mcp_oauth_clients (client_id) ON DELETE CASCADE,
    user_id         BIGINT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id BIGINT        NULL REFERENCES organizations (id) ON DELETE CASCADE,
    resource        VARCHAR(32)   NOT NULL,
    scopes          TEXT[]        NOT NULL,
    expires_at      TIMESTAMPTZ   NOT NULL,
    revoked_at      TIMESTAMPTZ   NULL,
    last_used_at    TIMESTAMPTZ   NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mcp_oauth_tokens_hash UNIQUE (token_hash),
    CONSTRAINT chk_mcp_oauth_tokens_kind CHECK (kind IN ('access', 'refresh')),
    CONSTRAINT chk_mcp_oauth_tokens_resource CHECK (resource IN ('/mcp/org', '/mcp/platform'))
);

CREATE INDEX idx_mcp_oauth_tokens_family ON mcp_oauth_tokens (family);
CREATE INDEX idx_mcp_oauth_tokens_grant ON mcp_oauth_tokens (grant_id);
CREATE INDEX idx_mcp_oauth_tokens_client ON mcp_oauth_tokens (client_id);
CREATE INDEX idx_mcp_oauth_tokens_expires ON mcp_oauth_tokens (expires_at);

-- Permissions: connecting MCP clients to an organization (owners and staff,
-- the tools still need their own tenant.* permissions), to the platform
-- endpoint, and managing registered clients platform wide.
INSERT INTO permissions (name, slug) VALUES
    ('Connect MCP clients to the organization', 'tenant.mcp.connect'),
    ('Connect MCP clients to the platform', 'platform.mcp.connect'),
    ('Manage MCP clients', 'platform.mcp.manage')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'tenant.mcp.connect'
WHERE r.slug IN ('organization_owner', 'organization_user', 'super_admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('platform.mcp.connect', 'platform.mcp.manage')
WHERE r.slug = 'super_admin'
ON CONFLICT DO NOTHING;

-- Plan toggle: MCP connections for the organization. Undefined = on; the
-- code upserts it at boot too.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('mcp.enabled', 'toggle', '', 'none', 'MCP bağlantıları (Claude, Cursor…)', 'MCP connections (Claude, Cursor…)', 72, TRUE)
ON CONFLICT (key) DO NOTHING;
