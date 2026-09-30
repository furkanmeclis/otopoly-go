# Agent brief: mobile backend work in `otopoly-go/backend`

> **IMPLEMENTATION HAS NOT STARTED.** Nothing in `otopoly-go` has been changed for this.
> **Do not start until the owner (Furkan Meclis) gives an explicit go-ahead**, and then do only
> the phase or phases approved. If the go-ahead covers one phase, stop at the end of it and
> report back.

- Spec (the source of truth for contracts): `otopoly-mobile-app/docs/backend/MOBILE_API_SPEC.md`
  (refs D1–D9, C1–C12 and N1–N13 below point into it).
- Work repo: `/Users/furkanmeclis/Documents/Projects/otopoly-go` (monorepo; backend in `backend/`,
  web in `frontend/`). The mobile repo is read-only for you, apart from updating this brief or the
  spec if you find a mistake in them.

## 1. Goals

1. Make the existing tenant API safe for a native client that talks to it directly: stable
   device sessions (refresh families, reuse detection, longer mobile TTL), no orphan sessions on
   org switch, logout that works with an expired access token, trusted-proxy aware rate limits,
   time-zone correct "today" queries, standard `sort` everywhere the app sends it.
2. Push notifications to iOS (APNs) and Android (FCM) through the existing notification
   pipeline, org-scoped inbox with deep links, per-type push preferences.
3. Server-driven job Live Activities and a compact `today` endpoint for widgets.
4. Offline-safe writes (`Idempotency-Key`), signed download links, app version gate,
   `Accept-Language` localized errors.

Out of scope: any change to `frontend/` beyond what the monorepo rules force in the same PR
(permission labels, i18n keys, `pnpm api:generate`), the WhatsApp/customer-facing messaging
flows, and the mobile app code.

## 2. Read first (conventions — follow them, do not reinvent)

| File | What it rules |
|---|---|
| `AGENTS.md` (repo root) | Hard rules: new `/v1` routes update `backend/docs/openapi.yaml` in the same change; permission slugs only via migration + `internal/platform/rbac/rbac.go` + `frontend/src/config/permissions.ts`; media URLs are API-owned; after OpenAPI changes run `cd frontend && pnpm api:generate`. |
| `backend/API_CONVENTIONS.md` | Envelope `{success,data,meta}`, error `{code,message,details}`, list `{items,total,limit,offset}`, `pkg/apiquery` (`limit`,`offset`,`q`,`sort`; `page`/`search` forbidden), `/meta` before `/{uuid}`, entitlement errors, notifications only via `Service.Enqueue`, events via the bus. |
| `backend/DATABASE_RULES.md` | golang-migrate sequential names (`make migrate-create NAME=…`), up+down, sqlc (`internal/database/queries/*.sql` → `internal/database/db`, never hand-edit), BIGSERIAL `id` + `uuid`, `set_updated_at()` trigger, index/constraint naming, Redis is not a source of truth. |
| `backend/docs/auth.md` | JWT claims (`sub`,`roles`,`sid`,`oid`,`imp`), sessions, rate-limit table, tenant login errors. |
| `docs/ARCHITECTURE.md`, `docs/EXTENDING.md` | Module layout and the narrative for adding a feature. |
| `.agents/skills/add-platform-resource/SKILL.md` | Order of work for a resource (DB → module → RBAC → OpenAPI → UI). |
| `.agents/skills/storage-media/SKILL.md` | Object storage and media URLs (for signed downloads). |
| `.agents/skills/step-up-engine/SKILL.md` | Step-up gate (for `PUT /v1/platform/mobile/config`). |
| `backend/TOOLCHAIN.md`, `backend/Makefile` | Tools and targets: `make test`, `make lint`, `make fmt`, `make sqlc`, `make migrate-up`, `make openapi-lint`. |

Module pattern (look at `internal/modules/jobs/` as the reference): `routes.go` (middleware chain
`authn` → `RequireOrganization` → `RequirePermission`), `handler/`, `usecase/` (business logic,
ports as interfaces), `repository/` or sqlc queries, `model/`. Routes are mounted from
`internal/httpserver/server.go`. Handlers never contain SQL; use cases never touch `pgxpool`.

## 3. Where each change goes (files as they exist today)

### Phase 0 — auth/session hardening and query fixes

| Spec ref | Change | Files |
|---|---|---|
| C2 | Refresh families, reuse detection, `last_used_at`, mobile TTL | Migration `000070_refresh_token_families`; `internal/database/queries/auth_tokens.sql`; `internal/modules/auth/usecase/auth.go` (`Refresh` ~l.370, `issueTokensForUser` ~l.518); `internal/modules/auth/repository/postgres.go` (`SaveRefresh`, `GetRefreshSession`, `RevokeRefresh`, new `RevokeFamily`); `internal/modules/auth/model/auth.go` (`SessionMeta` + `InstallationID`, `ClientType`, `AppVersion`); `internal/platform/jwt` (`sid` = family); `internal/config/config.go` (`JWT_REFRESH_TTL_MOBILE`, `JWT_REFRESH_ABSOLUTE_TTL_MOBILE`) |
| C1 | Read `X-Installation-ID`, `X-Client` into `SessionMeta` | `internal/modules/auth/handler/handler.go` `sessionMeta()` (~l.561) |
| C3 | Org-context rotates within the family | `internal/modules/auth/usecase/organizations.go` `SwitchOrganizationContext`; handler `SwitchOrganizationContext` |
| C4 | Logout without valid access token, revoke family, unregister device | `internal/modules/auth/routes.go` (drop `authn` from `POST /v1/auth/logout`, keep optional principal), `usecase/auth.go` `Logout` |
| C5 | Sessions list shows device + org + `last_used_at`, stable uuid | `internal/modules/auth/handler/sessions.go`, `usecase/sessions.go`, `model.DeviceSession` |
| §4.3 | Trusted proxies for client IP | `internal/config/config.go` (`TRUSTED_PROXIES`), `sessionMeta()` in auth handler, any other XFF reader (`grep -rn X-Forwarded-For internal`) |
| C6 | Catalog lists accept `sort` (keep `sort_by` alias) | `internal/modules/catalog/handler/handler.go` (~l.229, ~l.471), catalog usecase sort whitelist |
| C7 | Finance transactions `sort` | `internal/modules/finance/handler/handler.go` (list transactions), finance usecase + `queries/finance.sql` |
| C8 | `tz` param + `organizations.time_zone` | Migration `000074_organization_time_zone`; `internal/modules/jobs/handler` (List/Summary → `ListFilters.Location`, `SummaryIn`), `internal/modules/jobs/usecase/mappers.go` `parseDay`, `internal/modules/sales/usecase/mappers.go:76`, `internal/modules/reports/usecase/service.go` `parseRange`; org scope in `internal/platform/orgctx` should carry the time zone (loaded in `internal/middleware/organization.go`) |

### Phase 1 — push

| Spec ref | Change | Files |
|---|---|---|
| N1–N4 | Devices API | Migration `000068_mobile_devices`; new `internal/database/queries/mobile_devices.sql`; `internal/modules/notifications/handler/handler.go` (+ `devices.go`), `usecase/devices.go`, `model/model.go` (`MobileDevice`), `routes.go` (register next to `push-subscriptions`) |
| — | APNs + FCM senders | New `internal/modules/notifications/providers/apns.go`, `fcm.go` (token-based `.p8` JWT for APNs over HTTP/2; FCM HTTP v1 with service account); config in `internal/config/config.go` (`APNS_*`, `FCM_*`) mirroring `VAPIDConfig`; wiring in `internal/httpserver/server.go` where `providers.NoopProvider{Name: "push"}` is registered today |
| — | Send path | Extend `usecase/push.go` `pushBestEffort` (called from `Service.Deliver`, `usecase/service.go` ~l.290) to fan out to mobile devices via a new Asynq task `app:push:send` (queue `notifications`) in `internal/queue/tasks.go` + `notify_tasks.go` + worker registration in `internal/queue/worker.go`. Mark tokens invalid on APNs 410 / FCM `UNREGISTERED`. |
| C9 | Org-scoped inbox, `deep_link` | Migration `000073_notifications_org_and_push_prefs`; `queries/notifications.sql`; `model.EnqueueInput.TenantID` → persist `organization_id`; `usecase/service.go` `ListInbox`/`UnreadCount`; new `internal/modules/notifications/deeplink` (entity → `otopoly://…`) |
| C10 | `push` channel per type | `internal/modules/notifycenter/model/model.go` (`ChannelPush`, `ChannelPrefs.Push`, `AllChannels`), `usecase/preferences.go`, `usecase/process.go` `send` (~l.296) → route `push` to the notifications service; `queries/notification_center.sql` |
| — | Team kinds | `internal/platform/msgtemplate/registry.go` (add `job.team_assigned`, `job.team_ready`, `lead.team_assigned` with tr/en templates); new event `jobs.updated` in `internal/platform/events/catalog.go`, published from `internal/modules/jobs/usecase/service.go` (Patch, consumption and line changes) |

### Phase 2 — widgets and Live Activities

| Spec ref | Change | Files |
|---|---|---|
| N8 | `GET /v1/tenant/jobs/today` | `internal/modules/jobs/routes.go` (register before `/{uuid}`), `handler` (new `Today`), `usecase` (compose `List` with `IncludeOpen` + `SummaryIn`; shared `StaleAfterMinutes = 120`), ETag from a hash of the payload |
| N5–N7 | Live Activity token API | Migration `000069_live_activity_tokens`; `queries/live_activities.sql`; jobs module `handler/live_activities.go`, `usecase/live_activities.go`, routes in `internal/modules/jobs/routes.go` with `read` chain |
| — | Event → APNs `liveactivity` | New bus subscriber (e.g. `internal/modules/jobs/liveactivity_bus.go`, registered like `internal/modules/messaging/bus.go` `RegisterEventHandlers`) that only enqueues `app:liveactivity:push`; worker renders `JobActivityProps` and sends via the APNs provider (`apns-push-type: liveactivity`, topic `com.otopoly.app.push-type.liveactivity`). Labels: add `mobile.live.*` and `jobs.status.*` (tr/en) to `internal/platform/i18n/catalog.go`. Expiry sweep on the `maintenance` queue / `internal/queue/scheduler.go`. |

### Phase 3 — robustness and ops

| Spec ref | Change | Files |
|---|---|---|
| C12 | Idempotency middleware | Migration `000071_idempotency_keys`; `queries/idempotency.sql`; new `internal/middleware/idempotency.go`; apply in each listed module's `routes.go` chain (after `RequireOrganization`); purge task in `internal/queue` |
| N12–N13 | Signed downloads | `internal/modules/storage/routes.go` (next to `GET /v1/public/storage/s/{token}`), new `handler/downloads.go`, `usecase/downloads.go`; HMAC like `internal/modules/notifications/actionlink/actionlink.go`; producers call the existing PDF/usecase code of quotes, contracts, billing, exports (inject interfaces, do not import handlers) |
| N9–N11 + 426 | Version gate | Migration `000072_mobile_release_settings`; `queries/settings.sql` (or new file); `internal/modules/settings` (handler/usecase/routes); public route registered like `/v1/public/*`; new `internal/middleware/client_version.go` returning `426 APP_UPDATE_REQUIRED`; step-up on PUT via `middleware.RequireStepUp` |
| C11 | `Accept-Language` | New `internal/middleware/locale.go`; `internal/platform/i18n` (`WithLocale`, `FromContext`, `errors.<CODE>` keys); `pkg/response` error helpers translate by code |
| §4.6 | New error codes | `pkg/response` constants (`APP_UPDATE_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `PUSH_TOKEN_MISSING`, `LINK_EXPIRED`); frontend `src/locales/{en,tr}/errors.json` |

Every phase: update `backend/docs/openapi.yaml` (snippets in spec §5), run
`make openapi-lint`, then `cd frontend && pnpm api:generate` (monorepo rule).

## 4. Rules specific to this work

- Handlers only enqueue; APNs/FCM calls happen in the worker (`cmd/worker`). The event bus is
  synchronous (`internal/platform/events/bus.go`), so never do network I/O in a bus handler.
- Everything fails soft when APNs/FCM are not configured (no-op provider), like VAPID today.
- Job events carry only `job_uuid` (no `TenantID`); resolve org inside the task.
- Tokens/secrets (`push_token`, `APNS_KEY_P8`, FCM JSON) never go to logs; log a hash prefix.
- Impersonated sessions (`imp` claim) must not register devices or Live Activities.
- Keep money as decimal strings, timestamps RFC 3339 UTC in JSON; Live Activity props use epoch ms
  because that is the widget contract (`src/widgets/types.ts` in the mobile repo).
- Do not change response shapes of endpoints the app already uses beyond the additive changes in
  spec §3; additive fields only.
- Expand/contract for `refresh_tokens` (the web BFF keeps working during rollout).

## 5. Testing expectations

- Unit tests next to the code (`*_test.go`), table-driven, following
  `internal/modules/jobs/usecase/mappers_test.go` and `internal/modules/notifications/usecase/push_test.go`.
- DB tests with the `_DB` suffix gated on `DATABASE_URL` (pattern:
  `internal/modules/jobs/usecase/entitlements_db_test.go`, `t.Skip("DATABASE_URL not set")`).
- Required cases per phase = the acceptance checklist in spec §7, at minimum:
  refresh reuse revokes family; org switch keeps one session; logout with expired access token;
  device upsert idempotent + token moves between users; APNs 410 marks invalid (fake HTTP server);
  Live Activity payload golden test (server-rendered props equal the mobile `buildJobActivityProps`
  fixture); `jobs/today` golden test vs `buildTodayProps` incl. `tz`; idempotency replay/mismatch/
  in-progress; signed link expiry; `426` for old builds.
- APNs/FCM providers tested against `httptest.Server` fakes; no real network in tests.
- Before handing back: `make fmt`, `make lint`, `make test`, `make sqlc` (no diff),
  `make openapi-lint`, `make migrate-up` then `make migrate-down` for each new migration on a
  scratch DB.

## 6. Order of work

1. Get the owner's go-ahead and the list of approved phases.
2. Branch from `main` in `otopoly-go` (never commit to `main`), one PR per phase.
3. Phase 0: migration 000070 → sqlc → auth usecase/repo/handler (C1–C5) → trusted proxies →
   C6/C7 → migration 000074 + C8 → OpenAPI → tests → report.
4. Phase 1: migration 000068 → devices API (N1–N4) → providers + `app:push:send` →
   migration 000073 + C9/C10 → team kinds + `jobs.updated` → OpenAPI → tests.
5. Phase 2: N8 → migration 000069 + N5–N7 → bus subscriber + `app:liveactivity:push` + i18n labels
   → OpenAPI → tests.
6. Phase 3: C12 (000071) → N12–N13 → N9–N11 + 426 (000072) → C11 → OpenAPI → tests.
7. After each phase, list for the mobile team what they must change (e.g. `MFA_REQUIRED`,
   `X-Installation-ID` header, device registration calls) — do not edit the mobile repo yourself.

Migration numbers assume nothing else lands first; re-check `ls backend/migrations | tail` and
renumber sequentially if needed.
