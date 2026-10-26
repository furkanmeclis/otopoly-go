-- Reverts the MCP OAuth server. Data loss: registered MCP clients, pending
-- requests, codes, grants (connected apps), tokens, the mcp permissions and
-- the mcp.enabled plan values are removed.
DELETE FROM billing_plan_features
WHERE feature_id IN (SELECT id FROM billing_features WHERE key = 'mcp.enabled');
DELETE FROM billing_features WHERE key = 'mcp.enabled';

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE slug IN ('tenant.mcp.connect', 'platform.mcp.connect', 'platform.mcp.manage')
);
DELETE FROM permissions
WHERE slug IN ('tenant.mcp.connect', 'platform.mcp.connect', 'platform.mcp.manage');

DROP TABLE IF EXISTS mcp_oauth_tokens;
DROP TABLE IF EXISTS mcp_oauth_codes;
DROP TABLE IF EXISTS mcp_oauth_grants;
DROP TABLE IF EXISTS mcp_oauth_auth_requests;
DROP TABLE IF EXISTS mcp_oauth_clients;
