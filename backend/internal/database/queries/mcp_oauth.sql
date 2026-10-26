-- MCP OAuth 2.1 authorization server (docs/MCP.md).

-- name: CreateMCPOAuthClient :one
INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_ip)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetMCPOAuthClient :one
SELECT * FROM mcp_oauth_clients WHERE client_id = $1;

-- name: GetMCPOAuthClientByUUID :one
SELECT * FROM mcp_oauth_clients WHERE uuid = $1;

-- name: TouchMCPOAuthClient :exec
UPDATE mcp_oauth_clients SET last_used_at = NOW() WHERE client_id = $1;

-- name: CreateMCPOAuthAuthRequest :one
INSERT INTO mcp_oauth_auth_requests (client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetMCPOAuthAuthRequest :one
-- A pending request that has not expired, with its live client.
SELECT r.*, c.client_name
FROM mcp_oauth_auth_requests r
JOIN mcp_oauth_clients c ON c.client_id = r.client_id
WHERE r.id = $1 AND r.expires_at > NOW() AND c.revoked_at IS NULL;

-- name: DeleteMCPOAuthAuthRequest :execrows
-- Deleting is the claim: a concurrent second decision finds nothing.
DELETE FROM mcp_oauth_auth_requests WHERE id = $1 AND expires_at > NOW();

-- name: UpsertMCPOAuthGrant :one
-- Consent creates the user's connected app or brings a revoked one back.
INSERT INTO mcp_oauth_grants (user_id, client_id, organization_id, resource, scopes)
VALUES (sqlc.arg(user_id), sqlc.arg(client_id), sqlc.narg(organization_id), sqlc.arg(resource), sqlc.arg(scopes))
ON CONFLICT ON CONSTRAINT uq_mcp_oauth_grants_key
DO UPDATE SET scopes = EXCLUDED.scopes, revoked_at = NULL
RETURNING *;

-- name: CreateMCPOAuthCode :exec
INSERT INTO mcp_oauth_codes (
    code_hash, grant_id, client_id, user_id, organization_id,
    redirect_uri, code_challenge, resource, scopes, expires_at
) VALUES (
    sqlc.arg(code_hash), sqlc.arg(grant_id), sqlc.arg(client_id), sqlc.arg(user_id), sqlc.narg(organization_id),
    sqlc.arg(redirect_uri), sqlc.arg(code_challenge), sqlc.arg(resource), sqlc.arg(scopes), sqlc.arg(expires_at)
);

-- name: UseMCPOAuthCode :one
-- Marking the code used is the claim; an expired or used code returns no row.
UPDATE mcp_oauth_codes
SET used_at = NOW(), family = sqlc.arg(family)
WHERE code_hash = sqlc.arg(code_hash) AND used_at IS NULL AND expires_at > NOW()
RETURNING *;

-- name: GetUsedMCPOAuthCodeFamily :one
SELECT family FROM mcp_oauth_codes WHERE code_hash = $1 AND used_at IS NOT NULL;

-- name: CreateMCPOAuthToken :exec
INSERT INTO mcp_oauth_tokens (
    token_hash, kind, family, grant_id, client_id, user_id, organization_id,
    resource, scopes, expires_at
) VALUES (
    sqlc.arg(token_hash), sqlc.arg(kind), sqlc.arg(family), sqlc.arg(grant_id), sqlc.arg(client_id),
    sqlc.arg(user_id), sqlc.narg(organization_id), sqlc.arg(resource), sqlc.arg(scopes), sqlc.arg(expires_at)
);

-- name: GetActiveMCPOAuthToken :one
-- A live token of a live grant and client, with the user's status.
SELECT t.*, u.status AS user_status
FROM mcp_oauth_tokens t
JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
JOIN mcp_oauth_grants g ON g.id = t.grant_id
JOIN mcp_oauth_clients c ON c.client_id = t.client_id
WHERE t.token_hash = $1 AND t.kind = $2
  AND t.revoked_at IS NULL AND t.expires_at > NOW()
  AND g.revoked_at IS NULL AND c.revoked_at IS NULL;

-- name: GetMCPOAuthTokenAnyState :one
SELECT * FROM mcp_oauth_tokens WHERE token_hash = $1 AND kind = $2;

-- name: RevokeMCPOAuthToken :execrows
-- Revoking is the claim: of two concurrent refreshes only one wins.
UPDATE mcp_oauth_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeMCPOAuthFamily :exec
UPDATE mcp_oauth_tokens SET revoked_at = NOW() WHERE family = $1 AND revoked_at IS NULL;

-- name: TouchMCPOAuthToken :exec
-- Last use of the token and its grant (connected apps list).
WITH t AS (
    UPDATE mcp_oauth_tokens SET last_used_at = NOW() WHERE mcp_oauth_tokens.id = $1
    RETURNING grant_id
)
UPDATE mcp_oauth_grants SET last_used_at = NOW() WHERE mcp_oauth_grants.id = (SELECT grant_id FROM t);

-- name: CleanupMCPOAuthAuthRequests :execrows
DELETE FROM mcp_oauth_auth_requests WHERE expires_at < NOW();

-- name: CleanupMCPOAuthCodes :execrows
-- Used codes stay one day past expiry so a late replay still revokes.
DELETE FROM mcp_oauth_codes WHERE expires_at < NOW() - INTERVAL '1 day';

-- name: CleanupMCPOAuthTokens :execrows
-- Rotated refresh tokens stay until they expire, for reuse detection.
DELETE FROM mcp_oauth_tokens WHERE expires_at < NOW() - INTERVAL '1 day';

-- name: CleanupMCPOAuthClients :execrows
-- Registrations that never connected (no grant, token or pending request)
-- and are older than created_before.
DELETE FROM mcp_oauth_clients c
WHERE c.created_at < sqlc.arg(created_before)::timestamptz
  AND NOT EXISTS (SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id = c.client_id)
  AND NOT EXISTS (SELECT 1 FROM mcp_oauth_tokens t WHERE t.client_id = c.client_id)
  AND NOT EXISTS (SELECT 1 FROM mcp_oauth_auth_requests r WHERE r.client_id = c.client_id);

-- name: ListMCPOAuthSelectableOrgs :many
-- The user's active organizations (consent organization picker).
SELECT o.id, o.uuid, o.slug, o.name, om.role
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
WHERE om.user_id = $1
  AND o.status NOT IN ('suspended', 'expired')
  AND (o.access_starts_at IS NULL OR o.access_starts_at <= NOW())
  AND (o.access_ends_at IS NULL OR o.access_ends_at > NOW())
ORDER BY o.name ASC, o.id ASC;

-- name: ListUserMCPOAuthGrants :many
SELECT g.id, g.uuid, g.client_id, c.client_name, g.resource, g.scopes,
       g.last_used_at, g.created_at,
       o.uuid AS organization_uuid, o.slug AS organization_slug, o.name AS organization_name
FROM mcp_oauth_grants g
JOIN mcp_oauth_clients c ON c.client_id = g.client_id
LEFT JOIN organizations o ON o.id = g.organization_id
WHERE g.user_id = sqlc.arg(user_id)
  AND g.revoked_at IS NULL AND c.revoked_at IS NULL
  AND (sqlc.narg(resource)::text IS NULL OR g.resource = sqlc.narg(resource)::text)
  AND (sqlc.narg(organization_uuid)::uuid IS NULL OR o.uuid = sqlc.narg(organization_uuid)::uuid)
  AND (sqlc.narg(q)::text IS NULL OR c.client_name ILIKE '%' || sqlc.narg(q)::text || '%' OR o.name ILIKE '%' || sqlc.narg(q)::text || '%')
ORDER BY COALESCE(g.last_used_at, g.created_at) DESC, g.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountUserMCPOAuthGrants :one
SELECT COUNT(*)
FROM mcp_oauth_grants g
JOIN mcp_oauth_clients c ON c.client_id = g.client_id
LEFT JOIN organizations o ON o.id = g.organization_id
WHERE g.user_id = sqlc.arg(user_id)
  AND g.revoked_at IS NULL AND c.revoked_at IS NULL
  AND (sqlc.narg(resource)::text IS NULL OR g.resource = sqlc.narg(resource)::text)
  AND (sqlc.narg(organization_uuid)::uuid IS NULL OR o.uuid = sqlc.narg(organization_uuid)::uuid)
  AND (sqlc.narg(q)::text IS NULL OR c.client_name ILIKE '%' || sqlc.narg(q)::text || '%' OR o.name ILIKE '%' || sqlc.narg(q)::text || '%');

-- name: RevokeUserMCPOAuthGrant :one
-- Disconnects one of the user's apps; no row when missing, foreign or revoked.
UPDATE mcp_oauth_grants g
SET revoked_at = NOW()
FROM mcp_oauth_clients c
WHERE g.uuid = sqlc.arg(uuid) AND g.user_id = sqlc.arg(user_id)
  AND g.revoked_at IS NULL AND c.client_id = g.client_id
RETURNING g.id, g.uuid, g.client_id, c.client_name, g.resource, g.organization_id;

-- name: RevokeMCPOAuthGrantTokens :exec
-- Every token family of a grant; unused codes of the grant go too.
WITH codes AS (
    DELETE FROM mcp_oauth_codes WHERE mcp_oauth_codes.grant_id = sqlc.arg(grant_id) AND used_at IS NULL
)
UPDATE mcp_oauth_tokens SET revoked_at = NOW()
WHERE mcp_oauth_tokens.grant_id = sqlc.arg(grant_id) AND revoked_at IS NULL;

-- name: ListMCPOAuthClients :many
SELECT c.id, c.uuid, c.client_id, c.client_name, c.redirect_uris, c.created_ip,
       c.last_used_at, c.revoked_at, c.created_at,
       (SELECT COUNT(*) FROM mcp_oauth_grants g WHERE g.client_id = c.client_id AND g.revoked_at IS NULL)::bigint AS active_grants
FROM mcp_oauth_clients c
WHERE (
    sqlc.narg(status)::text IS NULL
    OR (sqlc.narg(status)::text = 'active' AND c.revoked_at IS NULL)
    OR (sqlc.narg(status)::text = 'revoked' AND c.revoked_at IS NOT NULL)
  )
  AND (sqlc.narg(q)::text IS NULL OR c.client_name ILIKE '%' || sqlc.narg(q)::text || '%' OR c.client_id ILIKE '%' || sqlc.narg(q)::text || '%')
ORDER BY c.created_at DESC, c.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountMCPOAuthClients :one
SELECT COUNT(*)
FROM mcp_oauth_clients c
WHERE (
    sqlc.narg(status)::text IS NULL
    OR (sqlc.narg(status)::text = 'active' AND c.revoked_at IS NULL)
    OR (sqlc.narg(status)::text = 'revoked' AND c.revoked_at IS NOT NULL)
  )
  AND (sqlc.narg(q)::text IS NULL OR c.client_name ILIKE '%' || sqlc.narg(q)::text || '%' OR c.client_id ILIKE '%' || sqlc.narg(q)::text || '%');

-- name: RevokeMCPOAuthClient :exec
-- Blocks the client and everything issued to it: grants, tokens, pending
-- requests and unused codes.
WITH c AS (
    UPDATE mcp_oauth_clients SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE mcp_oauth_clients.client_id = sqlc.arg(client_id)
    RETURNING client_id
), g AS (
    UPDATE mcp_oauth_grants SET revoked_at = NOW()
    WHERE mcp_oauth_grants.client_id = sqlc.arg(client_id) AND revoked_at IS NULL
), r AS (
    DELETE FROM mcp_oauth_auth_requests WHERE mcp_oauth_auth_requests.client_id = sqlc.arg(client_id)
), d AS (
    DELETE FROM mcp_oauth_codes WHERE mcp_oauth_codes.client_id = sqlc.arg(client_id) AND used_at IS NULL
)
UPDATE mcp_oauth_tokens SET revoked_at = NOW()
WHERE mcp_oauth_tokens.client_id = sqlc.arg(client_id) AND revoked_at IS NULL;
