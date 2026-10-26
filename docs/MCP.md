# MCP server (Claude, Cursor and other AI clients)

Otopoly is a remote [Model Context Protocol](https://modelcontextprotocol.io) server. AI clients such as
Claude (claude.ai, Claude Desktop, Claude Code), Cursor, VS Code or ChatGPT connect to it **by URL** and
work with Otopoly data through tools, signed in with the user's own Otopoly account. No password or API key
is shared with the client.

| Endpoint | Who connects | Tools |
|---|---|---|
| `https://<domain>/mcp/org` | Business owners and staff (`tenant.mcp.connect`) | Business tools in **one** organization chosen on the consent screen, with the member's tenant permissions there |
| `https://<domain>/mcp/platform` | Platform admins (`platform.mcp.connect`, super admins have it) | Read-only platform admin tools |

Code: `backend/internal/modules/oauth` (authorization server), `backend/internal/modules/mcp` (MCP server,
tool sets), `backend/internal/httpserver/mcp.go` (wiring); web: `frontend/src/features/mcp`,
`frontend/src/app/oauth/consent`, `frontend/src/app/{mcp,oauth,.well-known}/[...path]/route.ts`.
Migration: `000087_mcp_oauth`.

## 1. Why two endpoints

The two perspectives have different users, data and risk, so each is its own **protected resource**
(RFC 8707 audience). A token is bound to exactly one endpoint (`resource`) and, for `/mcp/org`, to exactly
one organization; a token of the other endpoint answers 401. A client that should see two organizations
connects twice (two connected apps). A single endpoint whose behaviour depends on the token would hide this
from the client and from the user (the client shows one server with a changing tool list), so it was not
chosen.

## 2. Transport and URLs

- **Streamable HTTP**, stateless (official Go SDK `github.com/modelcontextprotocol/go-sdk`). Every POST
  carries its own Bearer token and the tool list is computed per request. `GET` / `DELETE` answer 405.
- Only the frontend is public. Next.js forwards `/mcp/*`, `/oauth/*` (except the consent page) and
  `/.well-known/*` unchanged to the Go API (`frontend/src/lib/server/mcp-passthrough.ts`): no session,
  no cookies, Bearer and OAuth headers only, streamed bodies. The Nginx sidecar proxies every path to
  Next.js, so nothing extra is needed there.
- The issuer and resource URLs use `PUBLIC_FRONTEND_URL` (the public origin; already required in
  production). No new environment key.

## 3. OAuth 2.1 (MCP authorization spec)

| Step | Endpoint |
|---|---|
| Resource metadata (RFC 9728) | `GET /.well-known/oauth-protected-resource/mcp/{org\|platform}` |
| Authorization server metadata (RFC 8414) | `GET /.well-known/oauth-authorization-server` (also `/.well-known/oauth-authorization-server/mcp/{endpoint}` and `/.well-known/openid-configuration`) |
| Dynamic client registration (RFC 7591) | `POST /oauth/register` (public clients, `token_endpoint_auth_method: none`) |
| Authorization (code + PKCE S256) | `GET /oauth/authorize` → `302 /oauth/consent?request=<uuid>` |
| Consent screen (web, NextAuth session) | `/oauth/consent` → `GET /v1/mcp/oauth/requests/{uuid}`, `POST …/{uuid}/decide` |
| Token (code, refresh) | `POST /oauth/token` (form) |
| Revocation (RFC 7009) | `POST /oauth/revoke` (form) |

1. The client calls the MCP URL without a token and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://<domain>/.well-known/oauth-protected-resource/mcp/org"`.
2. It reads both metadata documents, registers itself and opens `/oauth/authorize` in the browser with
   `response_type=code`, `code_challenge` (S256 only, `plain` is refused), `state`, `resource` (the MCP URL;
   missing means `/mcp/org`) and optionally `scope`.
3. Go validates the request (unknown client or unregistered `redirect_uri` → an error page, never a
   redirect), stores it for 15 minutes and redirects to the consent page. The user signs in if needed
   (`/login?next=…`), sees the client name, its redirect host, the endpoint and the requested scopes, picks
   the organization (`/mcp/org`), optionally drops the write scope, and approves or denies.
4. Approve → `redirect_uri?code=…&state=…&iss=…` (code valid 5 minutes, single use). Deny →
   `error=access_denied`.
5. The client exchanges the code with the PKCE verifier. Access tokens live **1 hour**, refresh tokens
   **30 days** and **rotate** on every use. Reusing a rotated refresh token or a used code revokes the
   whole token family.

Redirect URIs: `https`, `http` on loopback (`localhost`, `127.0.0.1`, `[::1]`) and native app schemes
(`cursor://…`); no fragments, no credentials. Tokens, codes and requests are stored as SHA-256 hashes.

### Scopes

| Scope | Meaning |
|---|---|
| `mcp:read` | List and run read tools. Always granted. |
| `mcp:write` | Also run tools that change data (business endpoint only; `mcp:write` implies `mcp:read`). |

No `scope` in the request means every scope of the endpoint. Unknown scope values are ignored. The user can
untick write access on the consent screen; a refresh may narrow scopes, never widen them.

### Per-IP limits (Redis, fail-open)

`/oauth/register` 20/h, `/oauth/authorize` 60/h, `/oauth/token` 120/h, `/oauth/revoke` 120/h → `429` +
`Retry-After`, OAuth error `slow_down`.

## 4. Access checks on every MCP request

1. **Bearer token**: missing, unknown, expired, revoked, of a revoked grant or client, of a disabled user or
   of the other endpoint → `401` with the challenge above (`error="invalid_token"` when a token was sent).
2. **Plan**: the organization's plan toggle `mcp.enabled` (billing feature; undefined = on) off → `403`.
3. **Principal**: roles and permissions are read again on every request. `/mcp/org`: active membership,
   `tenant.mcp.connect`, organization not suspended / expired and inside its access window, else `403`.
   A `read_only` subscription hides the write tools (same rule as the panel). `/mcp/platform`:
   `platform.mcp.connect`, else `403`.
4. **Limits**: 60 requests/minute per connection (token family) and 600/hour per organization (per user on
   the platform endpoint) → HTTP `429`, `Retry-After`, JSON-RPC error `-32029`.
5. **`tools/list`** is the endpoint's tool set for that principal and the token's scopes; `tools/call` runs
   only tools from that list (anything else → `isError: true`, `TOOL_NOT_ALLOWED`).

Permissions (migration 000087, `internal/platform/rbac`, `frontend/src/config/permissions.ts`):
`tenant.mcp.connect` (organization_owner, organization_user, super_admin), `platform.mcp.connect` and
`platform.mcp.manage` (super_admin).

## 5. Tools

### Business endpoint (`/mcp/org`)

The tool set **reuses the AI assistant's registry** (`internal/modules/ai/tools`, see [AI.md](./AI.md)),
so each tool has the same permissions, organization isolation (use cases read the organization from
`orgctx`; another organization's uuid is "not found") and input validation as in the panel chat. The
platform admin's AI tool switches and the actions / todos feature switches on `/platform/ai` apply too;
the provider settings and the AI request quota do not (the model runs in the client). UI-only tools
(`render_chart`, `update_plan`) are left out. `list_leads` and `list_quotes` are MCP-only
(`internal/modules/mcp/orgtools`) and need the `module.quotes` plan toggle.

**Write tools** need the `mcp:write` scope. They are annotated `readOnlyHint: false`,
`destructiveHint: true`, so clients ask the user before each call. The call runs the tool's `Propose`
(validation and reference resolution, no side effects; input problems go back to the model as
`INVALID_INPUT`) and then `Run` with the normalized input. The result includes the change summary
(`change`) and the changed record (`record`). Activity events written by the change carry `"via": "mcp"`.

<!-- mcp-org-tools:start -->
| Tool | Kind | Permissions |
|---|---|---|
| `search_customers` | read | `tenant.customers.read` |
| `get_customer_account` | read | `tenant.cari.read` |
| `list_jobs` | read | `tenant.jobs.read` |
| `get_report_summary` | read | `tenant.reports.read` |
| `get_finance_balances` | read | `tenant.finance.read` |
| `get_sales_summary` | read | `tenant.sales.read` |
| `search_products` | read | `tenant.catalog.read` |
| `list_services` | read | `tenant.catalog.read` |
| `list_finance_categories` | read | `tenant.finance.read` |
| `search_vehicle_models` | read | `tenant.customers.read` |
| `list_todos` | read | `tenant.todos.read` |
| `list_leads` | read | `tenant.leads.read` (plan `module.quotes`) |
| `list_quotes` | read | `tenant.quotes.read` (plan `module.quotes`) |
| `list_reviews` | read | `tenant.reviews.read` (plan `reviews.enabled`) |
| `get_review_summary` | read | `tenant.reviews.read` (plan `reviews.enabled`) |
| `list_reorder_suggestions` | read | `tenant.purchases.read`, `tenant.catalog.read` (plan `stock_reorder.enabled`) |
| `get_customer_loyalty` | read | `tenant.loyalty.read`, `tenant.customers.read` (plan `loyalty.enabled`) |
| `list_loyalty_programs` | read | `tenant.loyalty.read` (plan `loyalty.enabled`) |
| `create_customer` | write | `tenant.customers.write`, `tenant.customers.read` |
| `add_customer_vehicle` | write | `tenant.customers.write`, `tenant.customers.read` |
| `create_job` | write | `tenant.jobs.write`, `tenant.customers.read`, `tenant.catalog.read` |
| `update_job_status` | write | `tenant.jobs.write`, `tenant.jobs.read` (+ `tenant.finance.read` with `payment_method`) |
| `record_job_payment` | write | `tenant.jobs.write`, `tenant.jobs.read`, `tenant.finance.read` |
| `cancel_job` | write | `tenant.jobs.write`, `tenant.jobs.read` (paid jobs: owner) |
| `quick_job` | write | `tenant.customers.write`, `tenant.customers.read`, `tenant.jobs.write`, `tenant.catalog.read` (+ `tenant.finance.read` with `payment_method`) |
| `create_quick_sale` | write | `tenant.sales.write`, `tenant.catalog.read`, `tenant.finance.read` |
| `record_cari_payment` | write | `tenant.cari.write`, `tenant.cari.read`, `tenant.finance.read` |
| `record_cari_charge` | write | `tenant.cari.write`, `tenant.cari.read` |
| `record_finance_entry` | write | `tenant.finance.write`, `tenant.finance.read` |
| `create_finance_transfer` | write | `tenant.finance.write`, `tenant.finance.read` |
| `update_finance_entry` | write | `tenant.finance.write`, `tenant.finance.read` (owner) |
| `void_finance_entry` | write | `tenant.finance.write`, `tenant.finance.read` (owner; cari entries also `tenant.cari.write`) |
| `create_todo` | write | `tenant.todos.write` |
| `complete_todo` | write | `tenant.todos.write` |
| `mark_review_followed_up` | write | `tenant.reviews.write`, `tenant.reviews.read` (owner; plan `reviews.enabled`) |
| `create_purchase_drafts` | write | `tenant.purchases.write`, `tenant.purchases.read`, `tenant.catalog.read` (owner; plan `stock_reorder.enabled`) |
| `sell_package` | write | `tenant.loyalty.apply`, `tenant.loyalty.read`, `tenant.customers.read`, `tenant.finance.read` (plan `loyalty.enabled`) |
| `redeem_reward` | write | `tenant.loyalty.apply`, `tenant.loyalty.read`, `tenant.jobs.write`, `tenant.jobs.read` (plan `loyalty.enabled`) |
<!-- mcp-org-tools:end -->

### Platform endpoint (`/mcp/platform`)

Read-only tools over the platform use cases (`internal/modules/mcp/platformtools`), each behind its
platform read permission.

<!-- mcp-platform-tools:start -->
| Tool | Kind | Permission |
|---|---|---|
| `list_organizations` | read | `platform.organizations.read` |
| `get_organization` | read | `platform.organizations.read` |
| `list_users` | read | `platform.users.read` |
| `get_user` | read | `platform.users.read` |
| `billing_dashboard` | read | `platform.billing.read` |
| `list_subscriptions` | read | `platform.billing.read` |
| `list_billing_orders` | read | `platform.billing.read` |
| `ai_usage` | read | `platform.ai.read` |
| `list_logs` | read | `platform.logs.read` |
| `log_stats` | read | `platform.logs.read` |
| `list_activity` | read | `platform.activity.read` |
| `system_health` | read | `platform.settings.read` |
<!-- mcp-platform-tools:end -->

`TestDocsListEveryTool` (`internal/modules/mcp/parity_test.go`) fails when these tables and the registries
drift apart.

### Results

A successful result has a short text line (`list_jobs: 10 of 42 items.`) followed by the JSON, which is also
`structuredContent`. Errors have `isError: true` and `structuredContent.error.code` ∈ `TOOL_NOT_ALLOWED`,
`INVALID_INPUT`, `TOOL_FAILED`, `RESULT_TOO_LARGE`. Free text from records is data (flattened by
`tools.DataText`), never instructions.

## 6. Audit log

Every `tools/call` writes `mcp.tool_called` (resource `mcp_tool`, actor = token user, attributed to the
token's organization) with `tool`, `endpoint`, `client_id`, `organization_id`, `scopes`, `duration_ms`,
`result` (`ok`, `error`, `not_allowed`), `code` and the **masked** `arguments`: values under personal keys
(`name`, `phone`, `email`, `plate`, `note`, `description`, `q`, …) and any e-mail address or phone number
are replaced with `***`; long strings are cut at 64 characters; uuids, dates, statuses and numbers stay.
Consent decisions (`mcp.consent_approved`, `mcp.consent_denied`), disconnects (`mcp.grant_revoked`) and
client blocks (`mcp.client_revoked`) are logged too.

## 7. Web pages

| Page | Path | Purpose |
|---|---|---|
| Consent | `/oauth/consent?request=<uuid>` | Choose the organization, review scopes, approve / deny |
| Connected apps (user) | Profile → **Bağlı uygulamalar** tab (`/t/{slug}/profile#connected-apps`, `/platform/profile#connected-apps`) | List and disconnect the user's MCP connections |
| Business guide | `/t/{slug}/settings/mcp` | Copy the `/mcp/org` URL, step-by-step setup, this organization's connections |
| Platform guide + clients | `/platform/mcp` | Copy the `/mcp/platform` URL, setup steps, registered clients (block with `platform.mcp.manage`) |

### /v1 endpoints (session)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/mcp/info` | `{org_url, platform_url, issuer, scopes, can_connect_org, can_connect_platform}` |
| GET | `/v1/mcp/oauth/requests/{uuid}` | Consent data: client, redirect host, resource, scopes, organizations (with tool counts), `allowed` |
| POST | `/v1/mcp/oauth/requests/{uuid}/decide` | `{decision: approve\|deny, organization_uuid?, scopes?}` → `{redirect_url}` |
| GET | `/v1/mcp/grants` | The user's connected apps; `q`, `realm=org\|platform`, `organization_uuid`, `limit`, `offset` |
| DELETE | `/v1/mcp/grants/{uuid}` | Disconnect: the grant and every token of it are revoked at once (204) |
| GET | `/v1/platform/mcp/clients` | Registered clients; `q`, `status=active\|revoked` (`platform.mcp.manage`) |
| DELETE | `/v1/platform/mcp/clients/{uuid}` | Block a client and everything issued to it (204) |

## 8. Connecting a client

The user only needs the endpoint URL (copy it from the guide page).

- **Claude (claude.ai, Desktop, mobile):** Settings → Connectors → *Add custom connector*. Name: Otopoly,
  URL: `https://<domain>/mcp/org` (or `/mcp/platform`). Press *Connect*; the Otopoly window opens, sign in,
  choose the business and press **İzin ver**. Team / Enterprise owners add it under organization settings
  first.
- **Claude Code:** `claude mcp add --transport http otopoly https://<domain>/mcp/org`, then run `/mcp` in a
  session and authenticate.
- **Cursor:** Settings → MCP → *Add new MCP server* (or `~/.cursor/mcp.json`:
  `{"mcpServers": {"otopoly": {"url": "https://<domain>/mcp/org"}}}`), then *Login*.
- **VS Code:** *MCP: Add Server* → HTTP → the URL; VS Code starts the sign-in.
- **ChatGPT:** Settings → Connectors (developer mode) → *Create*; URL + OAuth.

Any client that supports Streamable HTTP with OAuth (dynamic client registration + PKCE) works the same way.

## 9. Operations

- Expired requests, codes, tokens and never connected registrations (older than 7 days) are deleted every
  hour in the API process.
- Turn MCP off for a plan with the `mcp.enabled` toggle (Platform → Billing → Plans); existing tokens get
  `403` immediately.
- Revoke one user's connection from their profile; block a client for everyone from `/platform/mcp`.
- `/mcp/org` acts with the member's current permissions: removing the member or the `tenant.mcp.connect`
  permission stops the connection on the next request.
