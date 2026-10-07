# WhatsApp Cloud API + platform sender — design

Date: 2026-10-07 · Status: approved in chat (owner: Furkan Meclis)

## Goal

Send all business-to-customer WhatsApp notifications either from the business's
own number (paid plan feature, existing whatsmeow QR session) or from a single
**platform number** that the platform admin operates. The platform number can be
backed by **whatsmeow** or by the official **WhatsApp Cloud API**; the admin
picks the provider in the platform panel.

## Decisions (from the owner)

1. One platform number for all businesses (no per-business Cloud numbers now).
   Data model must not block adding per-business Cloud numbers later.
2. whatsmeow stays. Business-owned numbers keep using whatsmeow + QR.
3. New plan feature `whatsapp.own_number` (toggle). On → the business may connect
   its own number; messages go from it. Off → platform number.
4. Business own session disconnected → the business chooses via a setting
   "fall back to platform number" (default **on**). Off → message fails with
   `own_session_disconnected`.
5. Content: only businesses sending from their **own number** can edit
   notification texts (existing template editor). Every platform-number send uses
   the **platform template catalog** defined in code.
6. Cloud API templates: code ships a Turkish catalog; platform panel has
   "submit to Meta" + status sync per template; admin may override the Meta
   template name to map to a template created manually in Meta.
7. All Meta credentials are entered **manually by the platform admin in the
   panel** and stored encrypted in Postgres (`platform/crypto.SecretBox`).
   Nothing Meta-related in env.
8. No inbound customer messages. The webhook handles only `statuses`
   (sent/delivered/read/failed + pricing) and template status updates;
   `messages` events are acknowledged and dropped.
9. Library: `github.com/piusalfred/whatsapp` (MIT). Config is supplied per request
   through `config.ReaderFunc` reading the DB, so credential edits apply without
   restart. API version default `v26.0`, editable in the panel. Requires Go
   1.26.5 (bump `backend/go.mod`; Dockerfile already uses `golang:1.26-alpine`).

## Architecture

```
domain event ─► messaging.Dispatch / QueueSend (unchanged: rules, entitlements,
                outbound_messages row, asynq app:messaging:send)
                         │
                         ▼
               sendOutbound ─► SenderResolver.Resolve(org)
                         │
        ┌────────────────┼──────────────────────────┐
        ▼                ▼                          ▼
  org_own (whatsmeow,   platform_whatsmeow        platform_cloud
  org-edited text)      (catalog text rendered)   (catalog template + params)
```

### SenderResolver (`backend/internal/modules/messaging/usecase/resolver.go`)

1. `whatsapp.own_number` entitled **and** org session connected → `org_own`;
   body = org's own template (existing rendering).
2. Entitled but session not connected → if org `fallback_to_platform` → step 3,
   else fail `own_session_disconnected` (no retry).
3. Platform settings provider:
   - `cloud` → `platform_cloud`: send Meta template from catalog entry
     (approved name or override, language `tr`, positional body params,
     optional DOCUMENT header for quote PDF via media upload).
   - `whatsmeow` → `platform_whatsmeow`: catalog body rendered as plain text
     (document sends use existing SendDocument).
   - `none`/unconfigured or not connected → fail `platform_sender_not_configured`
     / `platform_sender_unavailable` (retryable for unavailable).
4. Existing checks (`whatsapp.enabled`, `whatsapp.monthly`) stay where they are
   and apply to every sender kind.

A Cloud template not in `APPROVED` state → fail `template_not_approved`
(no retry; visible in logs).

### Platform template catalog (`backend/internal/modules/messaging/catalog/`)

Go table, one entry per message kind that exists today. The implementer must
inventory **every** current WhatsApp send path (Dispatch events in
`model.AllEvents()`, `contract.otp`, quote send with PDF, daily summary, vehicle
alerts, notification-center messenger, simulate) and give each a catalog entry.
Entry fields: `Key` (e.g. `job.ready`), `MetaName` (e.g. `otopoly_job_ready`),
`Category` (`UTILITY`, `AUTHENTICATION` for OTP), `Language` (`tr`),
`Body` (Turkish, `{{1}}…{{n}}`), `Params` (ordered variable names from
`model.EventVariables`), `Example` values (Meta requires examples),
`HeaderDocument bool`, buttons where needed (OTP copy-code).
Texts must be strictly transactional (no promotional wording) so Meta classifies
them as UTILITY. Business name goes in as a parameter.

### Data model (migration `000075_whatsapp_platform_sender`)

- `platform_whatsapp_settings` (singleton, `id = 1`):
  `provider TEXT CHECK IN ('none','whatsmeow','cloud') DEFAULT 'none'`,
  Cloud: `app_id`, `waba_id`, `phone_number_id`, `api_version DEFAULT 'v26.0'`,
  `access_token_enc`, `app_secret_enc`, `webhook_verify_token_enc` (BYTEA),
  `display_phone`, whatsmeow: `wm_status`, `wm_jid`, `wm_phone`,
  `updated_at`, `updated_by`.
- `whatsapp_cloud_templates`: `key` (catalog key, unique), `meta_name`,
  `override_name NULL`, `language`, `category`, `status`
  (`not_submitted|pending|approved|rejected|paused|disabled`), `meta_template_id`,
  `rejected_reason`, `last_synced_at`.
- `whatsapp_sessions`: add `fallback_to_platform BOOLEAN NOT NULL DEFAULT TRUE`.
- `outbound_messages`: add `sender_kind TEXT NULL`, `template_name TEXT NULL`,
  `delivery_status TEXT NULL`, `delivery_status_at TIMESTAMPTZ NULL`,
  `pricing_category TEXT NULL`, `billable BOOLEAN NULL`, `error_code TEXT NULL`;
  index on `provider_reference`.
- `billing_features`: builtin `whatsapp.own_number` (toggle, sort 62, TR
  "Kendi WhatsApp numarası", EN "Own WhatsApp number"); trial plan → FALSE.
  Also add it to the code that upserts builtin features at boot.
- RBAC: `platform.integrations.whatsapp.read` / `.write` (super admin), via
  migration + `internal/platform/rbac` + `frontend/src/config/permissions.ts`.

Platform whatsmeow session: reuse `RealWhatsAppClientManager` with a reserved
key (`PlatformOrgKey = 0`); persistence of jid/status goes to
`platform_whatsapp_settings` instead of `whatsapp_sessions`. Org sessions are
untouched. Restore on boot like org sessions.

Tenant-side gating: when `whatsapp.own_number` is off, tenant session
connect endpoint returns 403 `feature_not_entitled`, the session card shows an
upsell state, and template editor endpoints are read-only/hidden. Existing
connected sessions of orgs without the feature are simply not used for sending
(do not delete them).

## API (all `/v1`, update `backend/docs/openapi.yaml`, then `pnpm api:generate`)

Platform (super admin + `platform.integrations.whatsapp.*`):

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/platform/integrations/whatsapp` | Masked settings: `*_configured` booleans, never plaintext; webhook URL (`PUBLIC_API_URL`-based public path) |
| PATCH | `/v1/platform/integrations/whatsapp` | Partial update; omitted secret = keep |
| POST | `/v1/platform/integrations/whatsapp/test` | Send test template (`hello_world` or catalog key) to a given number |
| POST | `/v1/platform/integrations/whatsapp/session/connect` | whatsmeow QR for platform number |
| DELETE | `/v1/platform/integrations/whatsapp/session` | Disconnect platform whatsmeow |
| GET | `/v1/platform/integrations/whatsapp/templates` | Catalog + stored status |
| POST | `/v1/platform/integrations/whatsapp/templates/submit` | Submit all (or given keys) not yet submitted |
| POST | `/v1/platform/integrations/whatsapp/templates/sync` | Pull statuses from Meta |
| PATCH | `/v1/platform/integrations/whatsapp/templates/{key}` | Set/clear `override_name` |

Public webhook (no auth, rate-limited):

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/public/whatsapp/webhook` | `hub.mode=subscribe` + verify token check → echo `hub.challenge` |
| POST | `/v1/public/whatsapp/webhook` | Verify `X-Hub-Signature-256` with app secret over the **raw body**; handle `statuses` (match `outbound_messages.provider_reference` = wamid, update delivery fields; status order never regresses, e.g. `read` is not overwritten by late `delivered`), `message_template_status_update` (update template row); ignore everything else; always 200 after valid signature |

The browser-facing proxy `frontend/src/app/api/v1/[...path]/route.ts` must pass
the POST body through byte-for-byte for this path (verify it does; fix if it
re-serialises JSON). Meta calls `https://<frontend domain>/api/v1/public/whatsapp/webhook`.

Tenant (existing messaging routes): session read returns `own_number_entitled`,
`fallback_to_platform`, `platform_sender_available`; new
`PATCH /v1/tenant/messaging/session/settings` for `fallback_to_platform`.
Outbound log exposes `sender_kind`, `delivery_status`, `error_code`.

## Frontend

- Platform: `/platform/integrations/whatsapp` (mirror GitHub integration page
  and `features/integrations/github`): provider selector; Cloud credential form
  (masked secrets, "configured" badges); webhook URL + copy; test send;
  whatsmeow QR card for platform number; template table (key, Meta name,
  override, category, status badge, rejected reason, submit/sync buttons).
  Nav entry under integrations.
- Tenant `settings/messaging`: own-number card respects entitlement (upsell
  when off), fallback toggle, template editor only when entitled; outbound
  list shows sender + delivery status.
- All strings in `frontend/src/locales/{en,tr}`.

## Error handling

- Graph API errors mapped to `error_code` (e.g. `131049` marketing limit,
  `131026` undeliverable, `132001` template missing, auth errors →
  `cloud_auth_failed`). Auth/config/template errors are non-retryable; network
  and 5xx are retryable via asynq.
- Secrets never logged; responses never include plaintext.

## Testing

- Resolver matrix unit tests (entitled × connected × fallback × provider).
- Catalog tests: every send path has an entry; params count equals `{{n}}`
  count; examples present; no entry is MARKETING.
- Cloud sender tests with a fake HTTP transport (no real Meta calls).
- Webhook tests: verify handshake, bad signature → 401, statuses update and no
  regression, template status update, unknown fields ignored.
- Platform settings service tests: secrets encrypted, masked on read, omitted
  secret keeps old value.
- Frontend: typecheck, lint, i18n check.

## Out of scope

Inbound messages/inbox, Embedded Signup, Coexistence, per-business Cloud
numbers, BSUID storage, marketing templates, Meta-billing dashboards.
