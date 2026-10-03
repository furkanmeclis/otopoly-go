# Otopoly Mobile — Backend API Specification

> **Status: SPECIFICATION ONLY.** Nothing here is implemented. The Go backend
> (`otopoly-go/backend`) has not been changed. Implementation needs the owner's go-ahead;
> the hand-off brief for that work is [`AGENT_BRIEF.md`](./AGENT_BRIEF.md).
>
> Prepared 2026-09-30 against:
> - mobile `main` @ `ac7fa4c` (Expo SDK 57, `expo-widgets` ~57.0.22)
> - backend working tree at `/Users/furkanmeclis/Documents/Projects/otopoly-go/backend`
>   (latest migration `000067_billing_lifecycle`, OpenAPI `docs/openapi.yaml`, 384 operations)

Contents

1. [Inventory of endpoints the app calls today](#1-inventory)
2. [New mobile-specific endpoints](#2-new-endpoints)
3. [Changes to existing endpoints](#3-changes-to-existing-endpoints)
4. [Cross-cutting concerns](#4-cross-cutting)
5. [Proposed OpenAPI snippets](#5-openapi-snippets)
6. [DB migration sketches](#6-migration-sketches)
7. [Phased rollout and acceptance checklist](#7-rollout)

Conventions used below come from the backend itself:
`backend/API_CONVENTIONS.md` (envelope, lists, error codes), `backend/DATABASE_RULES.md`
(migrations, sqlc, naming), `backend/docs/auth.md` (JWT, sessions, rate limits) and the repo-root
`AGENTS.md` (hard rules: new `/v1` routes update `docs/openapi.yaml` in the same change; permission
slugs only via migration + `internal/platform/rbac` + frontend `permissions.ts`).

Envelope reminder (all examples below are shown **with** the envelope only once, then as `data`):

```json
{ "success": true, "data": { }, "meta": { "request_id": "8b0c…" } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "push_token", "message": "required", "code": "required" }] }, "meta": { "request_id": "8b0c…" } }
{ "success": true, "data": { "items": [], "total": 0, "limit": 20, "offset": 0 }, "meta": { "request_id": "…" } }
```

---

## 1. Inventory

### 1.1 Method

- **Mobile side**: every `request` / `platformRequest` / `platformFormRequest` / `downloadAndShare` /
  `apiUrl` call in `src/features/*/services/*.service.ts`, `src/app/(app)/(tabs)/index.tsx`, the
  client internals in `src/api/client.ts`, plus every `route(...)` in `src/api/mock/handlers/*.ts`
  (every mock route is also called by a service — no orphan mocks). Result: **210 distinct
  method+path pairs**.
- **Backend side**: all `mux.Handle("METHOD /v1/…")` registrations under
  `backend/internal/**` (482 live routes) and all operations in `backend/docs/openapi.yaml`.
- **Result by path**: all 210 exist as live Go routes **and** in OpenAPI. There are **0 missing (❌)**
  endpoints among those the app calls today — the gaps are the *new* capabilities in §2.
- **Shape check**: done by reading the Go handler/usecase for auth, sessions, jobs, staff, todos,
  leads, quotes, catalog, finance, billing and contracts multipart, and comparing to the mobile
  types. Other modules' types were ported 1:1 from the web frontend services (which already talk to
  this backend), so they were checked for query-param names only (handler `r.URL.Query().Get(...)`
  vs. mobile param types). A generated contract test is proposed in §7 to close the rest.
- Note: several services are ported but not yet wired to screens (billing, contract presets,
  public quotes, `downloadAndShare`). They are still listed because they will be called.

**Totals: ✅ 191 · ⚠️ 19 · ❌ 0** (plus 13 new endpoints proposed in §2).

### 1.2 Difference notes (⚠️)

| Ref | Endpoint(s) | Mismatch | Evidence | Fix owner |
|---|---|---|---|---|
| D1 | `POST /v1/auth/login` | App waits for `TOTP_REQUIRED` to show the 2FA field (`src/app/(auth)/login.tsx:50`). Backend returns **`403 MFA_REQUIRED`** (`internal/modules/auth/handler/handler.go:590`, `response.CodeMFARequired`). Against the live API the TOTP step never shows. Also `ApiErrorCode` in `src/api/errors.ts` lists `UNAUTHORIZED`/`INTERNAL`, but the backend sends `UNAUTHENTICATED`/`INTERNAL_ERROR`. | handler.go:590, `pkg/response` codes | **Mobile** (change the code it checks); no backend change |
| D2 | `POST /v1/auth/logout` | Route runs behind `authn` (`internal/modules/auth/routes.go`). With an expired access token the client refreshes first (**this rotates the refresh token**), then replays the original body with the **old** refresh token. `Logout` treats "not found" as success (`usecase/auth.go:~405`), so the **new** refresh session stays alive for 7 days. | routes.go, usecase `Logout` | Backend (§3 C4) + mobile (read the token at send time) |
| D3 | `POST /v1/auth/organization-context` | Issues a new refresh session (`usecase/organizations.go:55` → `issueTokensForUser`) **without revoking the caller's session**. Every login (no `oid`) followed by an org pick, and every org switch, leaves an orphan session in `GET /v1/auth/sessions`. | organizations.go | Backend (§3 C3) |
| D4 | `POST /v1/auth/refresh` | Works (body `refresh_token`, single-use rotation, `usecase/auth.go:370`), but: (a) every rotation creates a **new `refresh_tokens.uuid`**, so the session/`sid` is not a stable device id and cannot anchor push tokens; (b) no reuse detection — presenting an already-rotated token just returns 401 and does not revoke the family; (c) `JWT_REFRESH_TTL` default 168h (`internal/config/config.go:261`) logs out a phone that is not opened for a week. | auth.go, config.go | Backend (§3 C2) |
| D5 | `GET /v1/tenant/catalog/products`, `GET /v1/tenant/catalog/services` | App sends `sort=name` (`src/features/sales/queries.ts:10`, via `ServerListParams.sort`). Handler reads **`sort_by`** (`internal/modules/catalog/handler/handler.go:229,471`) and ignores `sort` — also against API_CONVENTIONS (`sort` is the standard). | handler.go | Backend (§3 C6, accept `sort`), mobile may send `sort_by` meanwhile |
| D6 | `GET /v1/tenant/finance/transactions` | App sends `sort=-transaction_date,-created_at` (`src/app/(app)/(tabs)/finance.tsx:61`); the handler has no sort parameter, the value is ignored silently. | `internal/modules/finance/handler/handler.go` | Backend (§3 C7) or drop on mobile |
| D7 | `GET /v1/tenant/jobs`, `GET /v1/tenant/jobs/summary`, `GET /v1/tenant/sales/summary` | App sends the **device-local** day (`localToday()` in `src/features/jobs/lib/job-ui.ts`) as `date` / `date_from` / `date_to`. The backend turns it into a range with **`time.Local` of the server** (`internal/modules/jobs/usecase/mappers.go` `parseDay`, `internal/modules/sales/usecase/mappers.go:76`). If the API container runs in UTC, "today" is shifted by 3h for Turkish users (the AI module and daily-summary already hard-code `Europe/Istanbul`, `jobs/usecase/service.go:847`, `dailysummary/usecase/service.go:49`). | mappers.go | Backend (§3 C8: `tz` param / org time zone) |
| D8 | `GET /v1/tenant/quotes/{uuid}/pdf` (`previewUrl`, `?inline=1`) | Mobile builds a bare URL with `apiUrl()` for the viewer/browser. These routes need `Authorization: Bearer`, which a system browser / Quick Look / `Linking.openURL` cannot send → 401. `downloadAndShare` does send the header but does **not** refresh on 401. | `src/features/quotes/services/quotes.service.ts:87`, `src/api/files.ts` | Backend (§2.6 signed downloads) |
| D9 | `GET/POST /v1/platform/contract-presets`, `GET /…/meta`, `GET/PATCH/DELETE /…/{uuid}` (6 ops) | Platform admin routes (`internal/modules/contracts/routes.go:51-56`, `platform.*` permission). A tenant user always gets 403. The tenant equivalent the app should use is `GET /v1/tenant/contracts/presets` (already ✅). | contracts/routes.go | **Mobile** (remove `contract-presets.service.ts` or keep for super-admins only) |

Error-code alignment the app should also pick up (mobile-only work, listed for completeness):
the backend emits domain codes that `errors.codes.*` in `src/locales/*/errors.json` does not
translate yet — `WHATSAPP_NOT_CONNECTED`, `INVALID_TRANSITION`, `VEHICLE_REQUIRED`,
`OTP_REQUIRED`, `INVALID_OTP_CODE`, `OTP_CHANNEL_UNAVAILABLE`, `NO_RECIPIENT_PHONE`,
`CURRENCY_MISMATCH`, `PDF_UNAVAILABLE`, `PLAN_UNAVAILABLE`, `ORDER_OPEN`, `ORDER_STATE`,
`INVOICE_PROFILE_INVALID`, `DISCOUNT_INVALID`, `AI_*`. `SUBSCRIPTION_READ_ONLY` (403 from
`internal/middleware/organization.go:91`) should get a read-only notice like `LIMIT_REACHED` (mobile's global limit dialog, no purchase CTA).

### 1.3 Existing backend endpoints the app does not use yet (adopt instead of building new)

| Endpoint | Use in the app |
|---|---|
| `GET /v1/notifications`, `/unread-count`, `/{uuid}`, `POST /{uuid}/read`, `POST /read-all`, `GET /meta` | Notification inbox + tab badge (after §3 C9 adds org scoping). |
| `GET/PUT /v1/notification-preferences` | Global switch `push_enabled` (already a column, `migrations/000008`). |
| `GET /v1/app/config` | Auth method availability on the login screen (`internal/httpserver/server.go:661`). |
| `POST /v1/realtime/connection-token`, `/subscription-token` | Foreground live updates of the jobs board via Centrifugo instead of polling. |
| `POST /v1/auth/totp/*`, `GET /v1/auth/passkeys` | Security screen parity with web. |
| `GET /v1/search` | Global search. |

### 1.4 Full inventory

Legend: ✅ exists and matches · ⚠️ exists, see D-note · ❌ missing (none).

#### auth

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| POST | `/v1/auth/login` | ⚠️ D1 | auth.service.ts |
| POST | `/v1/auth/logout` | ⚠️ D2 | auth.service.ts |
| GET | `/v1/auth/me` | ✅ | auth.service.ts |
| POST | `/v1/auth/organization-context` | ⚠️ D3 | auth.service.ts, client.ts |
| POST | `/v1/auth/password/change` | ✅ | auth.service.ts |
| POST | `/v1/auth/password/forgot` | ✅ | auth.service.ts |
| PATCH | `/v1/auth/profile` | ✅ | auth.service.ts |
| POST | `/v1/auth/refresh` | ⚠️ D4 | auth.service.ts, client.ts |
| GET | `/v1/auth/sessions` | ✅ | auth.service.ts |
| POST | `/v1/auth/sessions/revoke-others` | ✅ | auth.service.ts |
| DELETE | `/v1/auth/sessions/{uuid}` | ✅ | auth.service.ts |
| GET | `/v1/auth/totp` | ✅ | auth.service.ts |
#### billing

Mobile never sells anything (no in-app purchases, App Store 3.1.1/3.1.3, Play payments policy):
it only reads usage. Plans, orders, payment reports, receipts, invoices and the invoice profile
are intentionally **not** called from mobile; the backend e-mails the tenant owner instead.

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/billing/overview` | ✅ | billing.service.ts (Usage & limits screen, staff seat meter) |

#### cari

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/cari` | ✅ | cari.service.ts |
| POST | `/v1/tenant/cari/entries/{uuid}/void` | ✅ | cari.service.ts |
| GET | `/v1/tenant/cari/meta` | ✅ | cari.service.ts |
| GET | `/v1/tenant/cari/summary` | ✅ | cari.service.ts |
| GET | `/v1/tenant/cari/{uuid}` | ✅ | cari.service.ts |
| POST | `/v1/tenant/cari/{uuid}/adjustments` | ✅ | cari.service.ts |
| POST | `/v1/tenant/cari/{uuid}/charges` | ✅ | cari.service.ts |
| GET | `/v1/tenant/cari/{uuid}/entries` | ✅ | cari.service.ts |
| POST | `/v1/tenant/cari/{uuid}/payments` | ✅ | cari.service.ts |

#### catalog

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/catalog/categories` | ✅ | catalog.service.ts |
| POST | `/v1/tenant/catalog/categories` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/categories/meta` | ✅ | catalog.service.ts |
| DELETE | `/v1/tenant/catalog/categories/{uuid}` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/categories/{uuid}` | ✅ | catalog.service.ts |
| PATCH | `/v1/tenant/catalog/categories/{uuid}` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/products` | ⚠️ D5 | catalog.service.ts |
| POST | `/v1/tenant/catalog/products` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/products/meta` | ✅ | catalog.service.ts |
| DELETE | `/v1/tenant/catalog/products/{uuid}` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/products/{uuid}` | ✅ | catalog.service.ts |
| PATCH | `/v1/tenant/catalog/products/{uuid}` | ✅ | catalog.service.ts |
| POST | `/v1/tenant/catalog/products/{uuid}/stock-adjustment` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/services` | ⚠️ D5 | catalog.service.ts |
| POST | `/v1/tenant/catalog/services` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/services/meta` | ✅ | catalog.service.ts |
| DELETE | `/v1/tenant/catalog/services/{uuid}` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/services/{uuid}` | ✅ | catalog.service.ts |
| PATCH | `/v1/tenant/catalog/services/{uuid}` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/services/{uuid}/products` | ✅ | catalog.service.ts |
| PUT | `/v1/tenant/catalog/services/{uuid}/products` | ✅ | catalog.service.ts |
| GET | `/v1/tenant/catalog/summary` | ✅ | catalog.service.ts |

#### contracts

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/contracts/instances` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances` | ✅ | contracts.service.ts |
| GET | `/v1/tenant/contracts/instances/{uuid}` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances/{uuid}/finalize` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances/{uuid}/media` | ✅ | contracts.service.ts |
| DELETE | `/v1/tenant/contracts/instances/{uuid}/media/{mediaUuid}` | ✅ | contracts.service.ts |
| GET | `/v1/tenant/contracts/instances/{uuid}/pdf` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances/{uuid}/signers/{signerUuid}/otp` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances/{uuid}/signers/{signerUuid}/otp/verify` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances/{uuid}/signers/{signerUuid}/sign` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/instances/{uuid}/void` | ✅ | contracts.service.ts |
| GET | `/v1/tenant/contracts/presets` | ✅ | contracts.service.ts |
| GET | `/v1/tenant/contracts/templates` | ✅ | index.tsx |
| POST | `/v1/tenant/contracts/templates` | ✅ | contracts.service.ts |
| POST | `/v1/tenant/contracts/templates/clone` | ✅ | contracts.service.ts |
| GET | `/v1/tenant/contracts/templates/meta` | ✅ | contracts.service.ts |
| DELETE | `/v1/tenant/contracts/templates/{uuid}` | ✅ | contracts.service.ts |
| GET | `/v1/tenant/contracts/templates/{uuid}` | ✅ | contracts.service.ts |
| PATCH | `/v1/tenant/contracts/templates/{uuid}` | ✅ | contracts.service.ts |

#### customers

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| DELETE | `/v1/tenant/customer-vehicles/{uuid}` | ✅ | customers.service.ts |
| GET | `/v1/tenant/customers` | ✅ | customers.service.ts |
| POST | `/v1/tenant/customers` | ✅ | customers.service.ts |
| GET | `/v1/tenant/customers/meta` | ✅ | customers.service.ts |
| DELETE | `/v1/tenant/customers/{uuid}` | ✅ | customers.service.ts |
| GET | `/v1/tenant/customers/{uuid}` | ✅ | customers.service.ts |
| PATCH | `/v1/tenant/customers/{uuid}` | ✅ | customers.service.ts |
| GET | `/v1/tenant/customers/{uuid}/jobs` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/customers/{uuid}/vehicles` | ✅ | customers.service.ts |
| GET | `/v1/tenant/vehicle-catalog/search` | ✅ | customers.service.ts |

#### finance

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/finance/accounts` | ✅ | finance.service.ts |
| POST | `/v1/tenant/finance/accounts` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/accounts/meta` | ✅ | finance.service.ts |
| DELETE | `/v1/tenant/finance/accounts/{uuid}` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/accounts/{uuid}` | ✅ | finance.service.ts |
| PATCH | `/v1/tenant/finance/accounts/{uuid}` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/accounts/{uuid}/detail` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/categories` | ✅ | finance.service.ts |
| POST | `/v1/tenant/finance/categories` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/categories/meta` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/categories/{uuid}` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/categories/{uuid}/detail` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/summary` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/transactions` | ⚠️ D6 | finance.service.ts |
| POST | `/v1/tenant/finance/transactions` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/transactions/meta` | ✅ | finance.service.ts |
| GET | `/v1/tenant/finance/transactions/{uuid}` | ✅ | finance.service.ts |
| POST | `/v1/tenant/finance/transactions/{uuid}/void` | ✅ | finance.service.ts |
| POST | `/v1/tenant/finance/transfers` | ✅ | finance.service.ts |

#### jobs

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/jobs` | ⚠️ D7 | jobs.service.ts |
| POST | `/v1/tenant/jobs` | ✅ | jobs.service.ts |
| GET | `/v1/tenant/jobs/meta` | ✅ | jobs.service.ts |
| GET | `/v1/tenant/jobs/summary` | ⚠️ D7 | jobs.service.ts |
| GET | `/v1/tenant/jobs/{uuid}` | ✅ | jobs.service.ts |
| PATCH | `/v1/tenant/jobs/{uuid}` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/cancel` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/close` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/consumptions` | ✅ | jobs.service.ts |
| DELETE | `/v1/tenant/jobs/{uuid}/consumptions/{consumptionUuid}` | ✅ | jobs.service.ts |
| PATCH | `/v1/tenant/jobs/{uuid}/consumptions/{consumptionUuid}` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/deliver` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/done` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/ready` | ✅ | jobs.service.ts |
| POST | `/v1/tenant/jobs/{uuid}/void` | ✅ | jobs.service.ts |

#### leads

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/leads` | ✅ | leads.service.ts |
| POST | `/v1/tenant/leads` | ✅ | leads.service.ts |
| GET | `/v1/tenant/leads/assignees` | ✅ | leads.service.ts |
| GET | `/v1/tenant/leads/summary` | ✅ | leads.service.ts |
| DELETE | `/v1/tenant/leads/{uuid}` | ✅ | leads.service.ts |
| GET | `/v1/tenant/leads/{uuid}` | ✅ | leads.service.ts |
| PATCH | `/v1/tenant/leads/{uuid}` | ✅ | leads.service.ts |
| POST | `/v1/tenant/leads/{uuid}/notes` | ✅ | leads.service.ts |
| POST | `/v1/tenant/leads/{uuid}/todo` | ✅ | leads.service.ts |

#### messaging / notifications

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/daily-summary` | ✅ | daily-summary.service.ts |
| PUT | `/v1/tenant/daily-summary` | ✅ | daily-summary.service.ts |
| GET | `/v1/tenant/daily-summary/preview` | ✅ | daily-summary.service.ts |
| POST | `/v1/tenant/daily-summary/test` | ✅ | daily-summary.service.ts |
| GET | `/v1/tenant/messaging/rules` | ✅ | messaging.service.ts |
| PATCH | `/v1/tenant/messaging/rules/{event_type}/{channel}` | ✅ | messaging.service.ts |
| DELETE | `/v1/tenant/messaging/session` | ✅ | messaging.service.ts |
| GET | `/v1/tenant/messaging/session` | ✅ | index.tsx |
| POST | `/v1/tenant/messaging/session/connect` | ✅ | messaging.service.ts |
| POST | `/v1/tenant/messaging/simulate` | ✅ | messaging.service.ts |
| GET | `/v1/tenant/messaging/template-types` | ✅ | templates.service.ts |
| DELETE | `/v1/tenant/messaging/template-types/{event_type}/{channel}/{locale}` | ✅ | templates.service.ts |
| PUT | `/v1/tenant/messaging/template-types/{event_type}/{channel}/{locale}` | ✅ | templates.service.ts |
| GET | `/v1/tenant/messaging/templates` | ✅ | messaging.service.ts |
| POST | `/v1/tenant/messaging/templates` | ✅ | messaging.service.ts |
| DELETE | `/v1/tenant/messaging/templates/{uuid}` | ✅ | messaging.service.ts |
| GET | `/v1/tenant/messaging/templates/{uuid}` | ✅ | messaging.service.ts |
| PATCH | `/v1/tenant/messaging/templates/{uuid}` | ✅ | messaging.service.ts |
| GET | `/v1/tenant/notification-preferences` | ✅ | tenant-notification-preferences.service.ts |
| PUT | `/v1/tenant/notification-preferences` | ✅ | tenant-notification-preferences.service.ts |
| GET | `/v1/tenant/vehicle-alerts` | ✅ | vehicle-alerts.service.ts |
| PUT | `/v1/tenant/vehicle-alerts` | ✅ | vehicle-alerts.service.ts |
| POST | `/v1/tenant/vehicle-alerts/test` | ✅ | vehicle-alerts.service.ts |

#### platform

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/platform/contract-presets` | ⚠️ D9 | contract-presets.service.ts |
| POST | `/v1/platform/contract-presets` | ⚠️ D9 | contract-presets.service.ts |
| GET | `/v1/platform/contract-presets/meta` | ⚠️ D9 | contract-presets.service.ts |
| DELETE | `/v1/platform/contract-presets/{uuid}` | ⚠️ D9 | contract-presets.service.ts |
| GET | `/v1/platform/contract-presets/{uuid}` | ⚠️ D9 | contract-presets.service.ts |
| PATCH | `/v1/platform/contract-presets/{uuid}` | ⚠️ D9 | contract-presets.service.ts |

#### public

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/public/organizations/by-slug/{slug}` | ✅ | auth.service.ts |
| GET | `/v1/public/quotes/{token}` | ✅ | quotes.service.ts |
| POST | `/v1/public/quotes/{token}/accept` | ✅ | quotes.service.ts |
| GET | `/v1/public/quotes/{token}/pdf` | ✅ | quotes.service.ts |
| POST | `/v1/public/quotes/{token}/reject` | ✅ | quotes.service.ts |

#### purchases

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/purchases` | ✅ | purchases.service.ts |
| POST | `/v1/tenant/purchases` | ✅ | purchases.service.ts |
| GET | `/v1/tenant/purchases/meta` | ✅ | purchases.service.ts |
| GET | `/v1/tenant/purchases/{uuid}` | ✅ | purchases.service.ts |
| POST | `/v1/tenant/purchases/{uuid}/void` | ✅ | purchases.service.ts |

#### quotes

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/quotes` | ✅ | quotes.service.ts |
| POST | `/v1/tenant/quotes` | ✅ | quotes.service.ts |
| GET | `/v1/tenant/quotes/summary` | ✅ | quotes.service.ts |
| GET | `/v1/tenant/quotes/{uuid}` | ✅ | quotes.service.ts |
| PUT | `/v1/tenant/quotes/{uuid}` | ✅ | quotes.service.ts |
| GET | `/v1/tenant/quotes/{uuid}/convert` | ✅ | quotes.service.ts |
| POST | `/v1/tenant/quotes/{uuid}/convert` | ✅ | quotes.service.ts |
| POST | `/v1/tenant/quotes/{uuid}/deliveries/{deliveryUuid}/retry` | ✅ | quotes.service.ts |
| POST | `/v1/tenant/quotes/{uuid}/duplicate` | ✅ | quotes.service.ts |
| GET | `/v1/tenant/quotes/{uuid}/pdf` | ⚠️ D8 | quotes.service.ts |
| PUT | `/v1/tenant/quotes/{uuid}/reminders` | ✅ | quotes.service.ts |
| POST | `/v1/tenant/quotes/{uuid}/send` | ✅ | quotes.service.ts |
| GET | `/v1/tenant/quotes/{uuid}/send-preview` | ✅ | quotes.service.ts |
| POST | `/v1/tenant/quotes/{uuid}/status` | ✅ | quotes.service.ts |

#### reports

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/reports/meta` | ✅ | reports.service.ts |
| GET | `/v1/tenant/reports/overview` | ✅ | reports.service.ts |

#### sales

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/sales` | ✅ | sales.service.ts |
| POST | `/v1/tenant/sales` | ✅ | sales.service.ts |
| GET | `/v1/tenant/sales/meta` | ✅ | sales.service.ts |
| GET | `/v1/tenant/sales/summary` | ⚠️ D7 | sales.service.ts |
| GET | `/v1/tenant/sales/{uuid}` | ✅ | sales.service.ts |
| POST | `/v1/tenant/sales/{uuid}/void` | ✅ | sales.service.ts |

#### staff

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/staff` | ✅ | staff.service.ts |
| POST | `/v1/tenant/staff` | ✅ | staff.service.ts |
| GET | `/v1/tenant/staff/meta` | ✅ | staff.service.ts |
| GET | `/v1/tenant/staff/options` | ✅ | staff.service.ts |
| PATCH | `/v1/tenant/staff/{uuid}` | ✅ | staff.service.ts |
| POST | `/v1/tenant/staff/{uuid}/reset-password` | ✅ | staff.service.ts |

#### suppliers

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/suppliers` | ✅ | suppliers.service.ts |
| POST | `/v1/tenant/suppliers` | ✅ | suppliers.service.ts |
| GET | `/v1/tenant/suppliers/meta` | ✅ | suppliers.service.ts |
| DELETE | `/v1/tenant/suppliers/{uuid}` | ✅ | suppliers.service.ts |
| GET | `/v1/tenant/suppliers/{uuid}` | ✅ | suppliers.service.ts |
| PATCH | `/v1/tenant/suppliers/{uuid}` | ✅ | suppliers.service.ts |

#### todos

| Method | Path | Status | Mobile caller |
|---|---|---|---|
| GET | `/v1/tenant/todos` | ✅ | todos.service.ts |
| POST | `/v1/tenant/todos` | ✅ | todos.service.ts |
| GET | `/v1/tenant/todos/assignees` | ✅ | todos.service.ts |
| GET | `/v1/tenant/todos/summary` | ✅ | todos.service.ts |
| DELETE | `/v1/tenant/todos/{uuid}` | ✅ | todos.service.ts |
| GET | `/v1/tenant/todos/{uuid}` | ✅ | todos.service.ts |
| PATCH | `/v1/tenant/todos/{uuid}` | ✅ | todos.service.ts |
| POST | `/v1/tenant/todos/{uuid}/complete` | ✅ | todos.service.ts |
| POST | `/v1/tenant/todos/{uuid}/reopen` | ✅ | todos.service.ts |

---

## 2. New endpoints

13 new operations. Every one is justified by a mobile feature that exists in the repo today or
is on the checklist (`docs/PORT_CHECKLIST.md`).

| # | Method | Path | Module (owner) | Auth / permission | Mobile feature |
|---|---|---|---|---|---|
| N1 | PUT | `/v1/notifications/devices/{installation_id}` | notifications | Bearer | Push registration (APNs/FCM), push-to-start token, device locale/tz |
| N2 | GET | `/v1/notifications/devices` | notifications | Bearer | "Devices & notifications" settings, diagnostics screen (`src/app/diagnostics.tsx`) |
| N3 | DELETE | `/v1/notifications/devices/{installation_id}` | notifications | Bearer | Logout / "turn off notifications on this phone" |
| N4 | POST | `/v1/notifications/devices/{installation_id}/test` | notifications | Bearer | Diagnostics "send test push" |
| N5 | PUT | `/v1/tenant/live-activities/{activity_id}` | jobs | Bearer + org + `tenant.jobs.read` | Job Live Activity (`src/widgets/job-activity.tsx`) updates while app is closed |
| N6 | DELETE | `/v1/tenant/live-activities/{activity_id}` | jobs | Bearer + org + `tenant.jobs.read` | "Stop Live Activity" (`endJobActivity` in `src/features/widgets/bridge.ts`) |
| N7 | GET | `/v1/tenant/live-activities` | jobs | Bearer + org + `tenant.jobs.read` | Reconcile after relaunch / reinstall (`runningJobActivities`) |
| N8 | GET | `/v1/tenant/jobs/today` | jobs | Bearer + org + `tenant.jobs.read` | Home/Lock Screen widgets (`buildTodayProps` in `src/features/widgets/props.ts`) + background refresh |
| N9 | GET | `/v1/public/mobile/config` | settings (new sub-area) | none | Force-update gate, maintenance banner |
| N10 | GET | `/v1/platform/mobile/config` | settings | `platform.settings.read` | Admin UI (web) to manage N9 values |
| N11 | PUT | `/v1/platform/mobile/config` | settings | `platform.settings.write` | idem |
| N12 | POST | `/v1/tenant/downloads` | storage (or new `downloads` module) | Bearer + org + permission of the target | Open PDFs in viewer/share sheet without a header (D8) |
| N13 | GET | `/v1/public/downloads/{token}` | storage | signed token | idem (streams the file) |

Why not a generic `/v1/mobile/*` prefix: the backend groups routes by owning module
(`internal/modules/*/routes.go`) and by audience (`/v1/auth`, `/v1/notifications`,
`/v1/tenant`, `/v1/platform`, `/v1/public`). Devices are user-scoped → notifications module;
Live Activities and "today" are job data → jobs module with the jobs RBAC; the version gate is
anonymous → `/v1/public`.

### 2.1 Device & push-token registration (N1–N4)

**Feature**: push notifications (APNs on iOS, FCM on Android), the per-device Live Activity
push-to-start token (iOS 17.2+, emitted by `addPushToStartTokenListener` in `expo-widgets`),
and per-device locale/time zone for server-rendered texts.

Identity: `installation_id` = a UUIDv4 the app creates once per install and keeps in
SecureStore (survives token rotation and org switches, reset on reinstall). One row per
`(user, installation_id)`. The same `installation_id` is sent as header `X-Installation-ID` on
login/refresh/org-context (§3 C1–C3) so sessions and devices link up.

#### N1 `PUT /v1/notifications/devices/{installation_id}` — register / refresh (idempotent upsert)

Called: after login, after every org switch, on app start when the token or locale changed, and
whenever APNs/FCM rotates a token.

Request:

```json
{
  "platform": "ios",
  "push_provider": "apns",
  "push_token": "a3f1…64 hex chars…",
  "apns_environment": "production",
  "bundle_id": "com.otopoly.app",
  "app_version": "1.0.0",
  "app_build": "42",
  "os_version": "18.2",
  "device_model": "iPhone16,2",
  "device_name": "Furkan's iPhone",
  "locale": "tr",
  "time_zone": "Europe/Istanbul",
  "push_enabled": true,
  "live_activities": {
    "enabled": true,
    "push_to_start_token": "80c2…hex…",
    "auto_start": "assigned_to_me"
  },
  "receive_all_organizations": false
}
```

| Field | Rules |
|---|---|
| `platform` | `ios` \| `android` (required) |
| `push_provider` | `apns` \| `fcm` (required when `push_token` is set). iOS uses raw APNs device tokens (`getDevicePushTokenAsync`), Android uses FCM registration tokens. Expo push tokens are **not** accepted — the backend talks to APNs/FCM directly (no third-party relay). |
| `push_token` | nullable (user denied permission); max 4096 |
| `apns_environment` | `sandbox` \| `production`; required for `apns` (TestFlight/App Store = production, dev builds = sandbox) |
| `locale` | normalized by `internal/platform/i18n.Normalize` (`tr`/`en`) |
| `time_zone` | IANA name, validated with `time.LoadLocation` |
| `live_activities.push_to_start_token` | iOS ≥ 17.2 only; nullable |
| `live_activities.auto_start` | `off` \| `assigned_to_me` \| `created_by_me` (default `off`) — when the server may remote-start a job activity on this device (§2.2) |
| `receive_all_organizations` | default `false`: tenant pushes go only to devices whose active organization (the `oid` of the calling token, stored as `organization_id`) matches the event's org. `true` = all orgs the user is a member of (payload carries `organization_slug`, the app switches context on tap). |

Server behaviour: stores `organization_id` from the token's `oid` (nullable), `user_id`,
`last_seen_at = now()`, links `refresh_family_id` of the current `sid` (§3 C2). If the same
`push_token` is registered by another user (shared phone, re-login), that other row's token is
cleared (a token belongs to one user at a time).

Response `200` (`201` on first create):

```json
{
  "installation_id": "5b0f6f9e-7d7a-4c49-9c55-3e7f7a1c2b10",
  "platform": "ios",
  "push_provider": "apns",
  "push_enabled": true,
  "push_token_status": "active",
  "locale": "tr",
  "time_zone": "Europe/Istanbul",
  "organization": { "uuid": "…", "slug": "parlak-oto", "name": "Parlak Oto" },
  "live_activities": { "enabled": true, "push_to_start": true, "auto_start": "assigned_to_me" },
  "app_version": "1.0.0",
  "app_build": "42",
  "last_seen_at": "2026-09-30T08:12:44Z",
  "created_at": "2026-09-01T10:00:00Z",
  "updated_at": "2026-09-30T08:12:44Z"
}
```

`push_token_status`: `active` \| `missing` \| `invalid` (APNs 410 / FCM `UNREGISTERED` seen —
the app re-registers on next launch).

Errors: `400 VALIDATION_ERROR` (details per field), `401 UNAUTHENTICATED`,
`429 RATE_LIMITED` (20/h per user).

#### N2 `GET /v1/notifications/devices`

List of the caller's devices (not paginated in practice; still the list envelope):
`data = { items: [Device…], total, limit, offset }`. Each item as N1 response plus `current: true`
when `installation_id` equals the request's `X-Installation-ID`.

#### N3 `DELETE /v1/notifications/devices/{installation_id}`

Removes the row (and its Live Activity tokens, §2.2). Called on logout **before** the logout
call. `200 { "deleted": true }`; `404 NOT_FOUND` if not the caller's.
Also triggered server-side by §3 C4 (logout revokes the session family and unregisters the
linked device) so a failed client call does not leave pushes flowing to a signed-out phone.

#### N4 `POST /v1/notifications/devices/{installation_id}/test`

Sends a localized test push to that device. `202 { "queued": true }`.
Errors: `409 CONFLICT` with `error.code = "PUSH_TOKEN_MISSING"` when no token, `429` (5/15 min).

#### Push payload contract (all pushes)

APNs:

```json
{
  "aps": {
    "alert": { "title": "Araç hazır", "body": "34 ABC 123 · Ahmet Yılmaz teslime hazır" },
    "sound": "default",
    "thread-id": "job:6b8d…",
    "category": "JOB_READY",
    "mutable-content": 1
  },
  "otopoly": {
    "v": 1,
    "type": "job.ready",
    "notification_uuid": "0f3c…",
    "organization_slug": "parlak-oto",
    "organization_uuid": "…",
    "deep_link": "otopoly://jobs/6b8d…",
    "entity": { "type": "job", "uuid": "6b8d…" }
  }
}
```

FCM: same `otopoly` object flattened into `data` (string values), `notification.title/body`,
`android.notification.channel_id` = the `type` group (`jobs`, `todos`, `quotes`, `system`).

Deep-link targets (must match Expo Router routes in `src/app`):

| `entity.type` | `deep_link` | Route today |
|---|---|---|
| `job` | `otopoly://jobs/{uuid}` | `src/app/(app)/jobs/[id].tsx` ✅ (also the Live Activity URL, `bridge.ts` `start(props, 'otopoly://jobs/…')`) |
| `customer` | `otopoly://customers/{uuid}` | `src/app/(app)/customers/[id].tsx` ✅ |
| `sale` | `otopoly://sales/{uuid}` | `src/app/(app)/sales/[id].tsx` ✅ |
| `todo` | `otopoly://todos/{uuid}` | planned (checklist §13) |
| `quote` | `otopoly://quotes/{uuid}` | planned |
| `lead` | `otopoly://leads/{uuid}` | planned |
| `notification` | `otopoly://notifications/{uuid}` | planned (inbox) |
| — | `otopoly://` | home |

The backend already stores `action_url` (a relative **web** path) on notifications. Add a pure
mapper `internal/modules/notifications/deeplink` that derives `deep_link` from `(entity type,
uuid)`; do not parse web URLs. Universal links (`https://…/t/{slug}/jobs/{uuid}`) need an
`apple-app-site-association` served by the **web frontend** domain — out of scope for the Go API,
noted in §7.

Which events push (server side, via `notifycenter` kinds; team kinds already exist in
`internal/platform/msgtemplate/registry.go`):

| Kind | Recipients | Exists? |
|---|---|---|
| `todo.reminder` | assignee | ✅ kind exists → add `push` channel |
| `quote.team_accepted` / `quote.team_rejected` / `quote.team_expiring` / `quote.team_created` | quote owner / members per prefs | ✅ → add `push` |
| `job.team_assigned` (new) | new assignee when `PATCH /jobs/{uuid}` changes `assignee_uuid` or on create | ❌ new kind + event `jobs.updated` |
| `job.team_ready` (new) | job creator + assignee (not the actor) on `jobs.ready` | ❌ new kind |
| `lead.team_assigned` (new) | assignee | ❌ new kind |
| `billing.*` (read-only / expiring) | org owners | optional, phase 3 |

Customer-facing kinds (`job.ready`, `job.delivered`, … → WhatsApp) are untouched.

### 2.2 Live Activities (N5–N7) and the server events that push updates

**Feature**: the job Live Activity (`JobActivity`, `src/widgets/job-activity.tsx`) today updates
only from `useWidgetSync` while the app is open. With per-activity push tokens the server can
update/end it when a colleague marks the car ready or delivered.

How `expo-widgets` models it (read from
`node_modules/expo-widgets/ios/Widgets/WidgetLiveActivity.swift` and `LiveActivityFactory.swift`):

- ActivityKit attributes type: **`LiveActivityAttributes`**, static attributes `{ "url": String? }`.
- Content state: **`{ "name": String, "props": String }`** — `name` is the activity name
  (`"JobActivity"`), `props` is the **JSON-encoded string** of `JobActivityProps`
  (`src/widgets/types.ts`). The widget runtime has no i18n, so **the server must send
  display-ready props** (translated labels, epoch-ms timestamps) — same contract as
  `buildJobActivityProps` in `src/features/widgets/props.ts`.
- Per-activity push token: `activity.addPushTokenListener` / `getPushToken()` (hex string).
- Push-to-start token: `addPushToStartTokenListener` → `activityPushToStartToken` (hex, iOS 17.2+),
  registered through N1 (`live_activities.push_to_start_token`).
- Pushes are only honoured if the app config enables Live Activity push
  (`expo-widgets` plugin option; mobile task, not backend).

#### N5 `PUT /v1/tenant/live-activities/{activity_id}`

`activity_id` = ActivityKit id (`activity.getId()`). Idempotent; called when the activity starts
and every time `addPushTokenListener` fires a new token.

```json
{
  "installation_id": "5b0f6f9e-7d7a-4c49-9c55-3e7f7a1c2b10",
  "kind": "job",
  "job_uuid": "6b8d0c7e-…",
  "push_token": "7c1e…hex…",
  "apns_environment": "production",
  "locale": "tr",
  "started_at": "2026-09-30T08:10:00Z"
}
```

Validation: job must belong to the token's org and be `in_progress` or `ready` (else
`409 INVALID_TRANSITION` — same code the jobs module already uses); device must belong to the
caller (`404 NOT_FOUND`). Max 5 active activities per device (`409 LIMIT_REACHED` with
`details.feature = "live_activities"`), matching ActivityKit's practical limits.

Response `200`:

```json
{
  "activity_id": "C8B2…",
  "kind": "job",
  "job_uuid": "6b8d…",
  "status": "active",
  "last_pushed_at": null,
  "expires_at": "2026-09-30T16:10:00Z"
}
```

`expires_at` = `started_at + 8h` (ActivityKit ends activities after 8h; the server stops pushing
after that and marks the row `expired`).

#### N6 `DELETE /v1/tenant/live-activities/{activity_id}`

User stopped the activity. `200 { "deleted": true }`.

#### N7 `GET /v1/tenant/live-activities?installation_id=…`

List envelope of the caller's active activities for that device; lets the app drop local index
entries (`widgets.job_activities` in `bridge.ts`) the server already ended.

#### Server events → APNs `liveactivity` pushes

Hook: a new bus subscriber (`internal/modules/jobs/liveactivity_bus.go` or
`internal/modules/notifications/liveactivity.go`) on events already published by
`internal/modules/jobs/usecase/service.go` (`s.publish(...)` lines 461, 533, 553, 587, 746, 840).
The bus is synchronous in-process (`internal/platform/events/bus.go` `MemoryBus.Publish`), so the
subscriber **only enqueues** an Asynq task (`app:liveactivity:push`, queue `notifications`); the
worker renders props and calls APNs. The events carry only `job_uuid` (no `TenantID`) — the worker
loads the job + org itself.

| Bus event | APNs `event` | Content (`props.status`) | Priority | Also |
|---|---|---|---|---|
| `jobs.ready` | `update` | `ready`, `finishedAt = completed_at` | 10 + `alert` ("Araç hazır") | — |
| `jobs.delivered` | `end` | `delivered`, `dismissal-date = now + 15 min` | 10 | row → `ended` |
| `jobs.cancelled` | `end` | `cancelled`, `dismissal-date = now + 15 min` | 10 | row → `ended` |
| `jobs.voided` | `end` | `cancelled` props, `dismissal-date = now` | 10 | row → `ended` |
| `jobs.closed` (paid) | `update` only if not yet delivered | unchanged status | 5 | — |
| `jobs.updated` (**new event**, publish from `Patch`, consumption/line changes) | `update` | new plate/customer/services | 5 | — |
| `jobs.created` with assignee (push-to-start) | `start` | `in_progress` | 10 + `alert` | only to devices with `auto_start` matching and a push-to-start token |

APNs request for an update:

```
POST https://api.push.apple.com/3/device/{activity_push_token}
apns-push-type: liveactivity
apns-topic: com.otopoly.app.push-type.liveactivity
apns-priority: 10
```

```json
{
  "aps": {
    "timestamp": 1790752800,
    "event": "update",
    "content-state": {
      "name": "JobActivity",
      "props": "{\"v\":1,\"jobId\":\"6b8d…\",\"plate\":\"34 ABC 123\",\"customer\":\"Ahmet Yılmaz\",\"vehicle\":\"Renault Clio 2021\",\"services\":\"İç-dış yıkama, Seramik\",\"status\":\"ready\",\"startedAt\":1790745000000,\"finishedAt\":1790752790000,\"org\":\"Parlak Oto\",\"labels\":{\"status\":\"Hazır\",\"elapsed\":\"Geçen süre\",\"hint\":\"Araç teslime hazır\"}}"
    },
    "stale-date": 1790781600,
    "alert": { "title": "Araç hazır", "body": "34 ABC 123 teslime hazır" }
  }
}
```

Push-to-start (`event: "start"`) additionally needs
`"attributes-type": "LiveActivityAttributes"` and `"attributes": { "url": "otopoly://jobs/6b8d…" }`,
and is sent to the device's push-to-start token. The started activity then reports its own token
via N5.

Rules:
- Payload ≤ 4 KB (truncate `services` to ~120 chars server-side).
- `timestamp` strictly increasing per activity (use event `OccurredAt`); ActivityKit drops older.
- Labels rendered from a server copy of the mobile strings `mobile.live.*` and `jobs.status.*`
  (tr/en) added to `internal/platform/i18n` — locale = the activity row's `locale`.
- APNs `410 Unregistered` / `BadDeviceToken` → mark row `invalid`, stop.
- Budget: iOS throttles high-priority Live Activity pushes; only status changes use priority 10.

### 2.3 `GET /v1/tenant/jobs/today` (N8) — compact summary for widgets

**Feature**: `OtopolyToday` / `OtopolyGlance` widgets. Today `use-widget-sync.ts` fetches up to
100 jobs (`GET /v1/tenant/jobs?limit=100&include_open=true&date_from=today&date_to=today`) plus
`GET /v1/tenant/jobs/summary` and computes everything in JS. A background task (iOS
`BGAppRefreshTask` via `expo-background-task`) or a silent push has ~30 s and little memory, so it
needs one small, cacheable call that returns exactly what `buildTodayProps` builds.

Query:

| Param | Default | Notes |
|---|---|---|
| `date` | today in `tz` | `YYYY-MM-DD` |
| `tz` | device's registered `time_zone` → org default → `Europe/Istanbul` | IANA; fixes D7 for this endpoint |
| `queue_limit` | 12 | max 30 (widget shows 12) |

Response `200` (`ETag` header; `If-None-Match` → `304`):

```json
{
  "date": "2026-09-30",
  "time_zone": "Europe/Istanbul",
  "organization": { "uuid": "…", "slug": "parlak-oto", "name": "Parlak Oto" },
  "stats": { "in_progress": 5, "ready": 2, "delivered": 7, "stale": 1 },
  "collected": { "amount": "18450.00", "currency": "TRY" },
  "queue": [
    {
      "uuid": "6b8d…",
      "plate": "34 ABC 123",
      "customer_name": "Ahmet Yılmaz",
      "vehicle_label": "Renault Clio 2021",
      "status": "ready",
      "started_at": "2026-09-30T06:10:00Z",
      "stale": false
    }
  ],
  "queue_total": 7,
  "stale_after_minutes": 120,
  "generated_at": "2026-09-30T09:02:11Z"
}
```

Semantics must equal `src/features/widgets/props.ts` so the widget never disagrees with the
dashboard:
- `in_progress` / `ready`: current open jobs (includes carry-over from previous days, same as
  `include_open=true`).
- `delivered`: status `delivered` with `delivered_at` on `date` or the day before (props.ts uses
  `shiftDate(today, -1)`).
- `stale`: `in_progress`, started today, `now - started_at ≥ 120 min` (`STALE_AFTER_MINUTES`,
  `src/features/jobs/lib/job-ui.ts:9`) — expose the constant so both sides agree.
- `queue`: ready first, then in_progress, ordered by `started_at desc`, `queue_limit` items.
- `collected`: `paid_total` of `GET /v1/tenant/jobs/summary` for `date`; `null` if the caller
  lacks the permission used by that summary (today `tenant.jobs.read` — unchanged).
- Money stays a decimal string (DATABASE_RULES: numeric); the app formats it.

Implementation: reuse `jobs/usecase.Service.List` (with `IncludeOpen`) and `SummaryIn(ctx, date, loc)`;
no new SQL needed for v1. Rate limit 120/h per user. Errors: standard org errors
(`ORGANIZATION_CONTEXT_REQUIRED`, `ORGANIZATION_ACCESS_EXPIRED`, `SUBSCRIPTION_READ_ONLY` does not
apply to GET).

Silent widget refresh (phase 3): on `jobs.*` events, enqueue a throttled (≤ 1 per 15 min per device)
APNs background push `{"aps":{"content-available":1},"otopoly":{"type":"widgets.refresh"}}`
(`apns-push-type: background`, priority 5) to devices of that org; the app calls N8 and
`updateSnapshot`. Apple limits background pushes, so the widget must still work on its own.

### 2.4 App version / minimum version (N9–N11)

**Feature**: force-update gate before the login screen, "update available" banner, maintenance
message. Builds ship via Xcode Cloud → TestFlight/App Store, so old binaries stay in the field.

#### N9 `GET /v1/public/mobile/config?platform=ios&version=1.0.0&build=42`

No auth; `Cache-Control: public, max-age=300`.

```json
{
  "platform": "ios",
  "status": "update_available",
  "min_supported_version": "1.0.0",
  "latest_version": "1.1.0",
  "update_url": "https://apps.apple.com/app/id000000000",
  "maintenance": { "active": false, "message": null },
  "features": { "live_activity_push": true, "widgets_background_refresh": false },
  "support": { "email": "destek@otopoly.com" },
  "server_time": "2026-09-30T09:02:11Z"
}
```

`status`: `ok` \| `update_available` \| `update_required` (version < min) \| `maintenance`.
Messages localized by `Accept-Language`.

Complementary header check: the app sends `X-Client: otopoly-ios/1.0.0 (42)` on every call; a
middleware returns **`426 APP_UPDATE_REQUIRED`** (`details: { min_supported_version, update_url }`)
for writes from builds below `min_supported_version`, so old clients cannot corrupt data after a
breaking API change. Missing header (web BFF) = no check.

#### N10/N11 `GET|PUT /v1/platform/mobile/config`

Platform admin editing of the same values per platform:

```json
{
  "ios":     { "min_supported_version": "1.0.0", "latest_version": "1.1.0", "update_url": "https://apps.apple.com/…", "maintenance_message": null, "features": { "live_activity_push": true } },
  "android": { "min_supported_version": "1.0.0", "latest_version": "1.0.0", "update_url": "https://play.google.com/…", "maintenance_message": null, "features": {} }
}
```

Permission `platform.settings.read` / `.write` (existing slugs, `internal/platform/rbac/rbac.go`),
plus step-up (`middleware.RequireStepUp`) on PUT because a wrong `min_supported_version` locks
every user out.

### 2.5 Notification inbox / preferences

No new endpoints: reuse `/v1/notifications*` and `/v1/tenant/notification-preferences` with the
changes in §3 C9–C10.

### 2.6 Signed download URLs (N12–N13)

**Feature**: open quote/contract/invoice PDFs in the native viewer (`WebView`/Quick Look) or hand
them to the share sheet / browser without an `Authorization` header (D8). Also removes the
"expired token during download" failure of `downloadAndShare`.

#### N12 `POST /v1/tenant/downloads`

```json
{ "resource": "quote_pdf", "uuid": "0c1d…", "inline": true }
```

`resource` whitelist → the permission checked **at signing time** and the file producer:

| `resource` | Existing route it proxies | Permission |
|---|---|---|
| `quote_pdf` | `GET /v1/tenant/quotes/{uuid}/pdf` | `tenant.quotes.read` |
| `contract_pdf` | `GET /v1/tenant/contracts/instances/{uuid}/pdf` | `tenant.contracts.read` |
| `billing_invoice_pdf` | `GET /v1/tenant/billing/invoices/{uuid}/pdf` | owner (same as today) |
| `billing_receipt` | `GET /v1/tenant/billing/orders/{uuid}/receipt` | owner |
| `export_file` | `GET /v1/tenant/exports/{uuid}/download` | the export's permission |

Response `201`:

```json
{
  "url": "https://api.otopoly.com/v1/public/downloads/eyJ…sig",
  "expires_at": "2026-09-30T09:07:11Z",
  "filename": "TEK-2026-0042.pdf",
  "mime_type": "application/pdf"
}
```

Token: `base64url(payload).hex(hmac_sha256)` with payload
`{org_id, user_id, resource, uuid, inline, exp}`, TTL 5 min, same HMAC approach as
`internal/modules/notifications/actionlink/actionlink.go` but its own secret/purpose string.
Rate limit 60/15 min per user. Always return an absolute URL built from a configured public base
(`APP_PUBLIC_API_URL`); the app never assembles storage keys (AGENTS.md hard rule).

#### N13 `GET /v1/public/downloads/{token}`

Streams the file with `Content-Type`, `Content-Disposition: inline|attachment; filename*=UTF-8''…`,
`Cache-Control: private, no-store`. Errors are JSON envelopes: `404 NOT_FOUND` (bad signature,
entity gone), `410` with code `LINK_EXPIRED`. Re-checks that the org is not suspended.

---

### 2.7 QR sign-in (otopoly-go `feat/qr-login`)

Web login page shows a QR for `https://otopoly.app/login/qr/{session_id}` (43-char base64url id, 120 s). The app opens it from the in-app scanner (`/qr-scan`) or the universal link and shows `/login/qr/[id]`. All Bearer calls use the active organization; the web session is scoped to it.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/auth/qr/sessions/{id}` | `{session_id, status: pending\|approved\|rejected, client:{browser, browser_version, os, device_type, user_agent}, ip, location:{country_code?, country?, region?, city?, source?}\|null, created_at, expires_at}`. First viewer claims the session. |
| `POST` | `/v1/auth/qr/sessions/{id}/approve` | `{status:"approved"}`. `403 ACCOUNT_DEACTIVATED`, `403 FORBIDDEN` (impersonating). |
| `POST` | `/v1/auth/qr/sessions/{id}/reject` | `{status:"rejected"}` |

Errors: `404 QR_SESSION_NOT_FOUND` (unknown / expired / used), `409 QR_SESSION_CLAIMED` (another account scanned it), `409 QR_SESSION_RESOLVED` (already answered), `429 RATE_LIMITED`.
Web-only (anonymous, mocked for the demo / smoke test): `POST /v1/auth/qr/sessions`, `POST /v1/auth/qr/sessions/{id}/state {browser_secret}`, `POST /v1/auth/qr/exchange {session_id, browser_secret, exchange_token}`.

## 3. Changes to existing endpoints

| Ref | Endpoint | Change | Fixes |
|---|---|---|---|
| C1 | `POST /v1/auth/login` | Read optional headers `X-Installation-ID`, `X-Client`; store on the refresh row (`installation_id`, `client_type = mobile_ios|mobile_android|web`, `app_version`). No response change. Document `403 MFA_REQUIRED` in OpenAPI (mobile switches from `TOTP_REQUIRED`). | D1, D4 |
| C2 | `POST /v1/auth/refresh` | Keep single-use rotation, add **`family_id`** (stable across rotations = the device session), `replaced_by_id`, `last_used_at`. Presenting an already-rotated token of a live family → revoke the **whole family** and return `401 UNAUTHENTICATED` with `details.reason = "refresh_reuse"` (theft signal, notify user). Grace window 30 s for the same token (two parallel app launches / widget extension). Mobile clients (`client_type` mobile_*) get `JWT_REFRESH_TTL_MOBILE` (proposal: 60 days sliding, 180 days absolute via `family_created_at`). Access TTL stays 15 min. `sid` claim becomes the **family** uuid. | D4 |
| C3 | `POST /v1/auth/organization-context` | Rotate instead of fork: revoke the caller's refresh row (by `sid`) and issue the new pair **in the same family**. Optional body `refresh_token` accepted for clients that want explicit rotation. | D3 |
| C4 | `POST /v1/auth/logout` | Accept without a valid access token (refresh token in body is the credential). Revoke the **family** of that token, delete `mobile_devices` rows linked to the family (stop pushes), end server-side Live Activity rows. Response unchanged `{ "status": "logged_out" }`. | D2 |
| C5 | `GET /v1/auth/sessions` | Items gain `device` (`installation_id`, `platform`, `device_name`, `device_model`, `app_version`), `organization` (`uuid`,`slug`,`name`), `last_used_at`, `client_type`; `uuid` = family uuid so it is stable. `DELETE /v1/auth/sessions/{uuid}` revokes the family + unregisters its device push. | device sessions list/revoke |
| C6 | `GET /v1/tenant/catalog/products`, `/services` | Accept standard `sort` (whitelist, `-` prefix), keep `sort_by` as deprecated alias; unknown → `400 VALIDATION_ERROR` per API_CONVENTIONS. | D5 |
| C7 | `GET /v1/tenant/finance/transactions` | Accept `sort` with whitelist `transaction_date`, `created_at`, `amount`. | D6 |
| C8 | `GET /v1/tenant/jobs`, `/jobs/summary`, `/sales/summary`, `/reports/overview` (+ N8) | Optional `tz` (IANA). Resolution order: `tz` → organization time zone (new column, default `Europe/Istanbul`) → never `time.Local`. `ListFilters.Location` already exists in `jobs/usecase/types.go:103`; wire it from the handler. | D7 |
| C9 | `GET /v1/notifications` (+ `unread-count`, `read-all`) | Add `organization_id` to `notifications` (nullable; platform notifications stay null) filled from `EnqueueInput.TenantID`/notifycenter `OrgID`. New filter `organization_uuid` (default: token `oid` if present, plus rows with null org). Projection gains `deep_link` and `organization` (`uuid`, `slug`). | Inbox per business, push tap target |
| C10 | `GET/PUT /v1/tenant/notification-preferences` | `prefs` gains `push` (`ChannelPrefs.Push`, column `push_enabled` on `notification_type_preferences`); `types[].channels` includes `"push"` for team kinds. Global `PUT /v1/notification-preferences` `push_enabled` stays the master switch. | Per-type push opt-out |
| C11 | All `/v1/*` | `Accept-Language` middleware (§4.2). | i18n |
| C12 | Offline-retried POSTs | `Idempotency-Key` support (§4.4). | Offline queue |

---

## 4. Cross-cutting

### 4.1 Auth for mobile

- **Transport**: mobile calls the Go API directly with Bearer tokens (`src/api/client.ts`), unlike
  the web (BFF + cookies). Refresh token lives in SecureStore (`src/api/session.ts`).
- **Lifetimes**: access 15 min (`JWT_ACCESS_TTL`), refresh per C2. Rotation single-use with family
  reuse detection. Widget extension never holds tokens — it only reads snapshots written by the
  app (keep it that way; do not share the refresh token through the App Group).
- **Device sessions**: C5 list/revoke; "sign out other devices" = existing
  `POST /v1/auth/sessions/revoke-others` (must also unregister those devices' pushes).
- **Client identification headers** (all requests): `X-Installation-ID: <uuid>`,
  `X-Client: otopoly-ios/1.0.0 (42)` (Android: `otopoly-android/…`). Logged into request logs
  (`internal/middleware/requestid.go` neighbourhood) for support.
- **Impersonation**: tokens with `imp` must not register devices or Live Activities
  (`403 FORBIDDEN`) — otherwise an admin's phone would receive a customer's pushes.

### 4.2 `Accept-Language` / i18n

The app sends `Accept-Language: tr|en` on every call (`baseHeaders()` in `client.ts`), but only the
AI handler reads it (`internal/modules/ai/handler/handler.go:306`). Error messages are hard-coded
(e.g. Turkish `SUBSCRIPTION_READ_ONLY` text in `internal/middleware/organization.go:92`).

Proposal: `middleware.Locale` puts `i18n.Normalize(header)` into the context
(`internal/platform/i18n` gets `WithLocale/FromContext`); `pkg/response` error helpers translate
`message` by code when a catalog key `errors.<CODE>` exists. The app keeps branching on
`error.code` (API_CONVENTIONS) and uses `message` only as fallback. Push/Live Activity texts use the
**device** locale (N1 `locale`), falling back to `users.locale` (`migrations/000003`, `tr`/`en`).

### 4.3 Rate limits

Existing: login/register/forgot/reset/verify (`internal/platform/ratelimit/limiter.go`, 15-min
window, fail-open). **Blocking issue**: the limiter keys on `X-Forwarded-For`
(`internal/modules/auth/handler/handler.go:561` `sessionMeta`), and `docs/auth.md` states the API must
not be reachable directly from clients. The mobile app **is** a direct client
(`EXPO_PUBLIC_API_URL`). Before live mode:
1. put the API behind the reverse proxy that overwrites (not appends) `X-Forwarded-For`, and
2. add `TRUSTED_PROXIES` config so XFF is only honoured from those peers.

New limits (use `Limiter.Allow(ctx, action, subject, limit, window)`, line 58):

| Action | Subject | Limit |
|---|---|---|
| refresh | family id | 30 / 15 min |
| device register (N1) | user | 20 / h |
| test push (N4) | user | 5 / 15 min |
| live activity register (N5) | user | 60 / h |
| today (N8) | user | 120 / h |
| sign download (N12) | user | 60 / 15 min |

All return `429 RATE_LIMITED` + `Retry-After` (app shows a toast for `RATE_LIMITED`,
`src/components/feedback/toast.tsx:75`).

### 4.4 Idempotency keys for offline-retried writes

The app will retry writes after `NETWORK_ERROR`/`TIMEOUT` (20 s timeout in `src/config/env.ts`).
Without a key a timed-out `POST /v1/tenant/jobs` that actually committed creates a duplicate job,
a duplicate cari payment, etc.

- Header `Idempotency-Key: <uuidv4>` (client generates once per user action, reuses on retry).
- Middleware `middleware.Idempotency` (new, `internal/middleware/idempotency.go`), applied to:
  `POST /v1/tenant/jobs`, `/jobs/{uuid}/ready|deliver|close|cancel|consumptions`,
  `POST /v1/tenant/sales`, `/purchases`, `/customers`, `/customers/{uuid}/vehicles`,
  `/cari/{uuid}/payments|charges|adjustments`, `/finance/transactions`, `/finance/transfers`,
  `/todos`, `/leads`, `/leads/{uuid}/notes`, `/quotes`, `/quotes/{uuid}/send`,
  `/contracts/instances`, `/billing/orders`.
- Scope `(organization_id, user_id, key)`; stores method, path, SHA-256 of body, status, response
  body; TTL 24 h; purge task on the `maintenance` queue.
- Same key + same hash, finished → replay stored status/body + header `Idempotent-Replayed: true`.
- Same key + different hash → `422`/`409` `IDEMPOTENCY_KEY_REUSED`.
- Same key still running → `409 IDEMPOTENCY_IN_PROGRESS` (+ `Retry-After: 1`).
- Only 2xx and 4xx (except 409/429) responses are stored; 5xx are not (retry allowed).
- Stored in Postgres (money writes need durability; DATABASE_RULES says Redis is not a business
  source of truth).

### 4.5 File download / share URLs

§2.6. Uploads stay multipart (`platformFormRequest`, field `file`, matches
`internal/modules/billing/handler/handler.go:288`, `contracts/handler/handler.go:454`). Media URLs
remain API-owned (`apiUrl()` only prefixes the origin).

### 4.6 Error codes the app maps

`src/api/errors.ts` + `src/components/feedback/toast.tsx` translate `errors.codes.<CODE>`;
global toast for network/5xx/`RATE_LIMITED`; `client.ts` handles `401` (refresh) and
`403 ORGANIZATION_CONTEXT_REQUIRED` (re-issue context) automatically.

| Code | HTTP | Source | App behaviour |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | `pkg/response` | refresh → retry → sign out |
| `ORGANIZATION_CONTEXT_REQUIRED` | 403 | `internal/middleware/organization.go:20` | re-issue context → retry |
| `NO_TENANT_MEMBERSHIP`, `ORGANIZATION_ACCESS_EXPIRED` | 403 | org middleware / login | org picker / expired screen |
| `SUBSCRIPTION_READ_ONLY` | 403 | org middleware:91 | billing prompt (new mapping) |
| `MFA_REQUIRED` | 403 | auth handler:591 | show TOTP field (**replace `TOTP_REQUIRED`**) |
| `INVALID_CREDENTIALS`, `INVALID_MFA_CODE` | 401/400 | auth | inline form error |
| `LIMIT_REACHED` (409), `FEATURE_DISABLED` (403) | | entitlements | limit dialog |
| `STEP_UP_REQUIRED` | 403 | step-up | re-auth sheet |
| `RATE_LIMITED` | 429 | limiter | toast, honour `Retry-After` |
| `VALIDATION_ERROR` | 400 | all | field errors from `details[]` |
| **new** `APP_UPDATE_REQUIRED` | 426 | §2.4 | force-update screen |
| **new** `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` | 409 | §4.4 | new key / wait+retry |
| **new** `PUSH_TOKEN_MISSING` | 409 | N4 | ask for notification permission |
| **new** `LINK_EXPIRED` | 410 | N13 | re-sign and reopen |

New codes go into `pkg/response` constants and the web + mobile `errors.codes` catalogs.

---

## 5. OpenAPI snippets

To be merged into `backend/docs/openapi.yaml` (OpenAPI 3.1, `bearerAuth`, shared responses
`BadRequest`, `Unauthenticated`, `Forbidden`, `NotFound`, `Conflict`, `TooManyRequests`,
`InternalError`, `ResponseMeta` and the `Envelope<Name>` pattern already defined there). Run
`make openapi-lint` afterwards.

```yaml
paths:
  /v1/notifications/devices:
    get:
      tags: [Notifications]
      summary: List the caller's mobile devices
      operationId: listMobileDevices
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: X-Installation-ID, in: header, required: false, schema: { type: string, format: uuid } }
      responses:
        "200":
          description: Devices
          content:
            application/json:
              schema: { $ref: "#/components/schemas/EnvelopeMobileDeviceList" }
        "401": { $ref: "#/components/responses/Unauthenticated" }

  /v1/notifications/devices/{installation_id}:
    parameters:
      - { name: installation_id, in: path, required: true, schema: { type: string, format: uuid } }
    put:
      tags: [Notifications]
      summary: Register or refresh a mobile device (push + Live Activity push-to-start)
      operationId: upsertMobileDevice
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/MobileDeviceUpsert" }
      responses:
        "200": { description: Updated, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeMobileDevice" } } } }
        "201": { description: Created, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeMobileDevice" } } } }
        "400": { $ref: "#/components/responses/BadRequest" }
        "401": { $ref: "#/components/responses/Unauthenticated" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/TooManyRequests" }
    delete:
      tags: [Notifications]
      summary: Unregister a mobile device
      operationId: deleteMobileDevice
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Deleted, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeDeleted" } } } }
        "401": { $ref: "#/components/responses/Unauthenticated" }
        "404": { $ref: "#/components/responses/NotFound" }

  /v1/notifications/devices/{installation_id}/test:
    parameters:
      - { name: installation_id, in: path, required: true, schema: { type: string, format: uuid } }
    post:
      tags: [Notifications]
      summary: Send a test push to one device
      operationId: testMobileDevicePush
      security: [{ bearerAuth: [] }]
      responses:
        "202": { description: Queued, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeQueued" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { $ref: "#/components/responses/Conflict" }
        "429": { $ref: "#/components/responses/TooManyRequests" }

  /v1/tenant/live-activities:
    get:
      tags: [Jobs]
      summary: List the caller's active Live Activities on a device
      operationId: listLiveActivities
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: installation_id, in: query, required: true, schema: { type: string, format: uuid } }
        - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 100 } }
        - { name: offset, in: query, schema: { type: integer, default: 0 } }
      responses:
        "200": { description: Page, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeLiveActivityList" } } } }
        "403": { $ref: "#/components/responses/Forbidden" }

  /v1/tenant/live-activities/{activity_id}:
    parameters:
      - { name: activity_id, in: path, required: true, schema: { type: string, maxLength: 128 } }
    put:
      tags: [Jobs]
      summary: Register / refresh the APNs update token of a job Live Activity
      operationId: upsertLiveActivity
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/LiveActivityUpsert" }
      responses:
        "200": { description: Registered, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeLiveActivity" } } } }
        "400": { $ref: "#/components/responses/BadRequest" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { $ref: "#/components/responses/Conflict" }
    delete:
      tags: [Jobs]
      summary: Stop server updates for a Live Activity
      operationId: deleteLiveActivity
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Deleted, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeDeleted" } } } }
        "404": { $ref: "#/components/responses/NotFound" }

  /v1/tenant/jobs/today:
    get:
      tags: [Jobs]
      summary: Compact "today" summary for widgets (tenant.jobs.read)
      operationId: getJobsToday
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: date, in: query, schema: { type: string, format: date } }
        - { name: tz, in: query, schema: { type: string, example: Europe/Istanbul } }
        - { name: queue_limit, in: query, schema: { type: integer, default: 12, maximum: 30 } }
        - { name: If-None-Match, in: header, schema: { type: string } }
      responses:
        "200":
          description: Summary
          headers: { ETag: { schema: { type: string } } }
          content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeJobsToday" } } }
        "304": { description: Not modified }
        "400": { $ref: "#/components/responses/BadRequest" }
        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/TooManyRequests" }

  /v1/public/mobile/config:
    get:
      tags: [Public]
      summary: Mobile app version gate and runtime flags
      operationId: getPublicMobileConfig
      parameters:
        - { name: platform, in: query, required: true, schema: { type: string, enum: [ios, android] } }
        - { name: version, in: query, required: true, schema: { type: string, example: 1.0.0 } }
        - { name: build, in: query, schema: { type: string } }
      responses:
        "200": { description: Config, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeMobileConfig" } } } }
        "400": { $ref: "#/components/responses/BadRequest" }

  /v1/platform/mobile/config:
    get:
      tags: [Platform]
      summary: Read mobile release settings (platform.settings.read)
      operationId: getPlatformMobileConfig
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Settings, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeMobileReleaseSettings" } } } }
        "403": { $ref: "#/components/responses/Forbidden" }
    put:
      tags: [Platform]
      summary: Update mobile release settings (platform.settings.write + step-up)
      operationId: putPlatformMobileConfig
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/MobileReleaseSettings" } } }
      responses:
        "200": { description: Saved, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeMobileReleaseSettings" } } } }
        "400": { $ref: "#/components/responses/BadRequest" }
        "403": { $ref: "#/components/responses/Forbidden" }

  /v1/tenant/downloads:
    post:
      tags: [Storage]
      summary: Create a short-lived signed URL for a tenant file
      operationId: createSignedDownload
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [resource, uuid]
              properties:
                resource: { type: string, enum: [quote_pdf, contract_pdf, billing_invoice_pdf, billing_receipt, export_file] }
                uuid: { type: string, format: uuid }
                inline: { type: boolean, default: false }
      responses:
        "201": { description: Signed, content: { application/json: { schema: { $ref: "#/components/schemas/EnvelopeSignedDownload" } } } }
        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/TooManyRequests" }

  /v1/public/downloads/{token}:
    get:
      tags: [Public]
      summary: Stream a file from a signed download URL
      operationId: getSignedDownload
      parameters:
        - { name: token, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: File
          content:
            application/pdf: { schema: { type: string, format: binary } }
            application/octet-stream: { schema: { type: string, format: binary } }
        "404": { $ref: "#/components/responses/NotFound" }
        "410": { description: LINK_EXPIRED, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }

components:
  schemas:
    MobileDeviceUpsert:
      type: object
      required: [platform]
      properties:
        platform: { type: string, enum: [ios, android] }
        push_provider: { type: [string, "null"], enum: [apns, fcm, null] }
        push_token: { type: [string, "null"], maxLength: 4096 }
        apns_environment: { type: [string, "null"], enum: [sandbox, production, null] }
        bundle_id: { type: string, maxLength: 255 }
        app_version: { type: string, maxLength: 32 }
        app_build: { type: string, maxLength: 32 }
        os_version: { type: string, maxLength: 32 }
        device_model: { type: string, maxLength: 64 }
        device_name: { type: string, maxLength: 128 }
        locale: { type: string, enum: [tr, en] }
        time_zone: { type: string, maxLength: 64 }
        push_enabled: { type: boolean, default: true }
        receive_all_organizations: { type: boolean, default: false }
        live_activities:
          type: object
          properties:
            enabled: { type: boolean }
            push_to_start_token: { type: [string, "null"], maxLength: 4096 }
            auto_start: { type: string, enum: [off, assigned_to_me, created_by_me], default: "off" }

    MobileDevice:
      type: object
      required: [installation_id, platform, push_enabled, push_token_status, locale, last_seen_at, created_at, updated_at]
      properties:
        installation_id: { type: string, format: uuid }
        platform: { type: string, enum: [ios, android] }
        push_provider: { type: [string, "null"], enum: [apns, fcm, null] }
        push_enabled: { type: boolean }
        push_token_status: { type: string, enum: [active, missing, invalid] }
        locale: { type: string }
        time_zone: { type: [string, "null"] }
        device_name: { type: [string, "null"] }
        device_model: { type: [string, "null"] }
        app_version: { type: [string, "null"] }
        app_build: { type: [string, "null"] }
        current: { type: boolean }
        organization: { $ref: "#/components/schemas/OrganizationRef" }
        live_activities:
          type: object
          properties:
            enabled: { type: boolean }
            push_to_start: { type: boolean }
            auto_start: { type: string, enum: [off, assigned_to_me, created_by_me] }
        last_seen_at: { type: string, format: date-time }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }

    OrganizationRef:
      type: [object, "null"]
      properties:
        uuid: { type: string, format: uuid }
        slug: { type: string }
        name: { type: string }

    LiveActivityUpsert:
      type: object
      required: [installation_id, kind, job_uuid, push_token]
      properties:
        installation_id: { type: string, format: uuid }
        kind: { type: string, enum: [job] }
        job_uuid: { type: string, format: uuid }
        push_token: { type: string, maxLength: 4096 }
        apns_environment: { type: string, enum: [sandbox, production] }
        locale: { type: string, enum: [tr, en] }
        started_at: { type: string, format: date-time }

    LiveActivity:
      type: object
      required: [activity_id, kind, job_uuid, status, expires_at]
      properties:
        activity_id: { type: string }
        kind: { type: string, enum: [job] }
        job_uuid: { type: string, format: uuid }
        status: { type: string, enum: [active, ended, expired, invalid] }
        last_pushed_at: { type: [string, "null"], format: date-time }
        expires_at: { type: string, format: date-time }

    JobsToday:
      type: object
      required: [date, time_zone, stats, queue, queue_total, stale_after_minutes, generated_at]
      properties:
        date: { type: string, format: date }
        time_zone: { type: string }
        organization: { $ref: "#/components/schemas/OrganizationRef" }
        stats:
          type: object
          required: [in_progress, ready, delivered, stale]
          properties:
            in_progress: { type: integer }
            ready: { type: integer }
            delivered: { type: integer }
            stale: { type: integer }
        collected:
          type: [object, "null"]
          properties:
            amount: { type: string, example: "18450.00" }
            currency: { type: string, example: TRY }
        queue:
          type: array
          items:
            type: object
            required: [uuid, plate, customer_name, vehicle_label, status, started_at, stale]
            properties:
              uuid: { type: string, format: uuid }
              plate: { type: string }
              customer_name: { type: string }
              vehicle_label: { type: string }
              status: { type: string, enum: [in_progress, ready] }
              started_at: { type: string, format: date-time }
              stale: { type: boolean }
        queue_total: { type: integer }
        stale_after_minutes: { type: integer, example: 120 }
        generated_at: { type: string, format: date-time }

    MobileConfig:
      type: object
      required: [platform, status, min_supported_version, latest_version, maintenance, server_time]
      properties:
        platform: { type: string, enum: [ios, android] }
        status: { type: string, enum: [ok, update_available, update_required, maintenance] }
        min_supported_version: { type: string }
        latest_version: { type: string }
        update_url: { type: [string, "null"], format: uri }
        maintenance:
          type: object
          properties:
            active: { type: boolean }
            message: { type: [string, "null"] }
        features: { type: object, additionalProperties: { type: boolean } }
        support: { type: object, properties: { email: { type: string, format: email } } }
        server_time: { type: string, format: date-time }

    MobileReleaseSettings:
      type: object
      properties:
        ios: { $ref: "#/components/schemas/MobilePlatformRelease" }
        android: { $ref: "#/components/schemas/MobilePlatformRelease" }
    MobilePlatformRelease:
      type: object
      required: [min_supported_version, latest_version]
      properties:
        min_supported_version: { type: string, pattern: "^\\d+\\.\\d+\\.\\d+$" }
        latest_version: { type: string, pattern: "^\\d+\\.\\d+\\.\\d+$" }
        update_url: { type: [string, "null"], format: uri }
        maintenance_message: { type: [string, "null"] }
        features: { type: object, additionalProperties: { type: boolean } }

    SignedDownload:
      type: object
      required: [url, expires_at, filename, mime_type]
      properties:
        url: { type: string, format: uri }
        expires_at: { type: string, format: date-time }
        filename: { type: string }
        mime_type: { type: string }

    # Envelopes follow the existing pattern (see EnvelopeSearchSpecs):
    EnvelopeMobileDevice:
      type: object
      required: [success, data, meta]
      properties:
        success: { type: boolean, enum: [true] }
        data: { $ref: "#/components/schemas/MobileDevice" }
        meta: { $ref: "#/components/schemas/ResponseMeta" }
    EnvelopeMobileDeviceList:
      type: object
      required: [success, data, meta]
      properties:
        success: { type: boolean, enum: [true] }
        data:
          type: object
          required: [items, total, limit, offset]
          properties:
            items: { type: array, items: { $ref: "#/components/schemas/MobileDevice" } }
            total: { type: integer }
            limit: { type: integer }
            offset: { type: integer }
        meta: { $ref: "#/components/schemas/ResponseMeta" }
    # EnvelopeLiveActivity, EnvelopeLiveActivityList, EnvelopeJobsToday, EnvelopeMobileConfig,
    # EnvelopeMobileReleaseSettings, EnvelopeSignedDownload, EnvelopeDeleted ({deleted: boolean}),
    # EnvelopeQueued ({queued: boolean}) — same shape, omitted for brevity.
```

Changes to existing schemas (same PR as the behaviour change): `DeviceSession` (+`device`,
`organization`, `last_used_at`, `client_type`), `Notification` (+`deep_link`, `organization`),
tenant `ChannelPrefs` (+`push`), login `403 MFA_REQUIRED` response, `tz` parameter on the C8
routes, `sort` on C6/C7, `Idempotency-Key` header parameter (`components/parameters/IdempotencyKey`)
on the C12 routes, `426` response `AppUpdateRequired`.

---

## 6. Migration sketches

Next free number is **000068** (`ls backend/migrations | tail` → `000067_billing_lifecycle`).
Create with `make migrate-create NAME=…` (sequential, golang-migrate). Each has an `up` and a `down`.
`set_updated_at()` trigger function exists since `000002`.

### 000068_mobile_devices

```sql
-- up
CREATE TABLE mobile_devices (
    id                         BIGSERIAL    PRIMARY KEY,
    uuid                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    user_id                    BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    installation_id            UUID         NOT NULL,
    organization_id            BIGINT       NULL REFERENCES organizations (id) ON DELETE SET NULL,
    refresh_family_id          UUID         NULL,
    platform                   VARCHAR(16)  NOT NULL CHECK (platform IN ('ios','android')),
    push_provider              VARCHAR(8)   NULL CHECK (push_provider IN ('apns','fcm')),
    push_token                 TEXT         NULL,
    push_token_status          VARCHAR(16)  NOT NULL DEFAULT 'missing'
                               CHECK (push_token_status IN ('active','missing','invalid')),
    apns_environment           VARCHAR(16)  NULL CHECK (apns_environment IN ('sandbox','production')),
    push_to_start_token        TEXT         NULL,
    live_activities_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,
    live_activity_auto_start   VARCHAR(24)  NOT NULL DEFAULT 'off'
                               CHECK (live_activity_auto_start IN ('off','assigned_to_me','created_by_me')),
    push_enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
    receive_all_organizations  BOOLEAN      NOT NULL DEFAULT FALSE,
    bundle_id                  VARCHAR(255) NOT NULL DEFAULT '',
    app_version                VARCHAR(32)  NOT NULL DEFAULT '',
    app_build                  VARCHAR(32)  NOT NULL DEFAULT '',
    os_version                 VARCHAR(32)  NOT NULL DEFAULT '',
    device_model               VARCHAR(64)  NOT NULL DEFAULT '',
    device_name                VARCHAR(128) NOT NULL DEFAULT '',
    locale                     VARCHAR(8)   NOT NULL DEFAULT 'tr' CHECK (locale IN ('tr','en')),
    time_zone                  VARCHAR(64)  NULL,
    last_seen_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    invalidated_at             TIMESTAMPTZ  NULL,
    created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_mobile_devices_uuid UNIQUE (uuid),
    CONSTRAINT uq_mobile_devices_user_installation UNIQUE (user_id, installation_id)
);
CREATE UNIQUE INDEX uq_mobile_devices_push_token ON mobile_devices (push_token) WHERE push_token IS NOT NULL;
CREATE INDEX idx_mobile_devices_user ON mobile_devices (user_id);
CREATE INDEX idx_mobile_devices_org_active ON mobile_devices (organization_id)
    WHERE push_token_status = 'active' AND push_enabled;
CREATE INDEX idx_mobile_devices_family ON mobile_devices (refresh_family_id) WHERE refresh_family_id IS NOT NULL;
CREATE TRIGGER trg_mobile_devices_updated_at BEFORE UPDATE ON mobile_devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- down (drops all registered devices: pushes stop until apps re-register)
DROP TABLE IF EXISTS mobile_devices;
```

Note: the existing `push_subscriptions` table (`000010`, web push/VAPID) stays as is; web and
mobile push are different transports.

### 000069_live_activity_tokens

```sql
-- up
CREATE TABLE live_activity_tokens (
    id               BIGSERIAL    PRIMARY KEY,
    uuid             UUID         NOT NULL DEFAULT gen_random_uuid(),
    activity_id      VARCHAR(128) NOT NULL,
    mobile_device_id BIGINT       NOT NULL REFERENCES mobile_devices (id) ON DELETE CASCADE,
    user_id          BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    organization_id  BIGINT       NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    kind             VARCHAR(16)  NOT NULL DEFAULT 'job' CHECK (kind IN ('job')),
    job_id           BIGINT       NOT NULL REFERENCES service_jobs (id) ON DELETE CASCADE,
    push_token       TEXT         NOT NULL,
    apns_environment VARCHAR(16)  NOT NULL DEFAULT 'production',
    locale           VARCHAR(8)   NOT NULL DEFAULT 'tr',
    status           VARCHAR(16)  NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','ended','expired','invalid')),
    last_event_at    TIMESTAMPTZ  NULL,   -- monotonic APNs "timestamp" guard
    last_pushed_at   TIMESTAMPTZ  NULL,
    started_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ  NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_live_activity_tokens_uuid UNIQUE (uuid),
    CONSTRAINT uq_live_activity_tokens_device_activity UNIQUE (mobile_device_id, activity_id)
);
CREATE INDEX idx_live_activity_tokens_job_active ON live_activity_tokens (job_id) WHERE status = 'active';
CREATE INDEX idx_live_activity_tokens_expires ON live_activity_tokens (expires_at) WHERE status = 'active';
CREATE TRIGGER trg_live_activity_tokens_updated_at BEFORE UPDATE ON live_activity_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- down
DROP TABLE IF EXISTS live_activity_tokens;
```

(Jobs live in `service_jobs`, created in `migrations/000034_create_service_jobs.up.sql`; queries in `internal/database/queries/jobs.sql`.)

### 000070_refresh_token_families

```sql
-- up (expand only; existing rows get their own uuid as family)
ALTER TABLE refresh_tokens
    ADD COLUMN family_id         UUID        NULL,
    ADD COLUMN family_created_at TIMESTAMPTZ NULL,
    ADD COLUMN replaced_by_id    BIGINT      NULL REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    ADD COLUMN installation_id   UUID        NULL,
    ADD COLUMN client_type       VARCHAR(16) NOT NULL DEFAULT 'web'
               CHECK (client_type IN ('web','mobile_ios','mobile_android')),
    ADD COLUMN app_version       VARCHAR(32) NULL,
    ADD COLUMN last_used_at      TIMESTAMPTZ NULL;
UPDATE refresh_tokens SET family_id = uuid, family_created_at = created_at WHERE family_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX idx_refresh_tokens_installation ON refresh_tokens (user_id, installation_id)
    WHERE installation_id IS NOT NULL;

-- down (loses family/device linkage; sessions keep working)
DROP INDEX IF EXISTS idx_refresh_tokens_installation;
DROP INDEX IF EXISTS idx_refresh_tokens_family;
ALTER TABLE refresh_tokens
    DROP COLUMN IF EXISTS last_used_at, DROP COLUMN IF EXISTS app_version,
    DROP COLUMN IF EXISTS client_type, DROP COLUMN IF EXISTS installation_id,
    DROP COLUMN IF EXISTS replaced_by_id, DROP COLUMN IF EXISTS family_created_at,
    DROP COLUMN IF EXISTS family_id;
```

### 000071_idempotency_keys

```sql
-- up
CREATE TABLE idempotency_keys (
    id              BIGSERIAL    PRIMARY KEY,
    organization_id BIGINT       NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id         BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    idem_key        VARCHAR(128) NOT NULL,
    method          VARCHAR(8)   NOT NULL,
    path            TEXT         NOT NULL,
    request_hash    CHAR(64)     NOT NULL,
    state           VARCHAR(16)  NOT NULL DEFAULT 'running' CHECK (state IN ('running','done')),
    response_status INTEGER      NULL,
    response_body   JSONB        NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ  NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE UNIQUE INDEX uq_idempotency_keys_scope
    ON idempotency_keys (COALESCE(organization_id, 0), user_id, idem_key);
CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys (expires_at);

-- down
DROP TABLE IF EXISTS idempotency_keys;
```

### 000072_mobile_release_settings

```sql
-- up
CREATE TABLE mobile_release_settings (
    id                    BIGSERIAL   PRIMARY KEY,
    platform              VARCHAR(16) NOT NULL CHECK (platform IN ('ios','android')),
    min_supported_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    latest_version        VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    update_url            TEXT        NULL,
    maintenance_message   TEXT        NULL,
    features              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_by            BIGINT      NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_mobile_release_settings_platform UNIQUE (platform)
);
INSERT INTO mobile_release_settings (platform) VALUES ('ios'), ('android');  -- reference data
CREATE TRIGGER trg_mobile_release_settings_updated_at BEFORE UPDATE ON mobile_release_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- down
DROP TABLE IF EXISTS mobile_release_settings;
```

### 000073_notifications_org_and_push_prefs

```sql
-- up
ALTER TABLE notifications ADD COLUMN organization_id BIGINT NULL REFERENCES organizations (id) ON DELETE CASCADE;
CREATE INDEX idx_notifications_user_org_created ON notifications (user_id, organization_id, created_at DESC);
ALTER TABLE notification_type_preferences ADD COLUMN push_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- down
ALTER TABLE notification_type_preferences DROP COLUMN IF EXISTS push_enabled;
DROP INDEX IF EXISTS idx_notifications_user_org_created;
ALTER TABLE notifications DROP COLUMN IF EXISTS organization_id;
```

### 000074_organization_time_zone

```sql
-- up
ALTER TABLE organizations ADD COLUMN time_zone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul';
-- down
ALTER TABLE organizations DROP COLUMN IF EXISTS time_zone;
```

No new permission slugs are required: devices are user-scoped (Bearer only), Live Activities and
`jobs/today` reuse `tenant.jobs.read`, release settings reuse `platform.settings.*`, downloads reuse
each resource's read permission. (If the owner wants a separate switch, add
`tenant.live_activities.use` via migration + `rbac.go` + frontend `permissions.ts`, per AGENTS.md.)

Config (env, `internal/config/config.go`, same style as `VAPID_*`):
`APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_KEY_P8` (PEM contents, secret), `APNS_BUNDLE_ID=com.otopoly.app`,
`APNS_DEFAULT_ENV=production`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON` (secret),
`JWT_REFRESH_TTL_MOBILE`, `JWT_REFRESH_ABSOLUTE_TTL_MOBILE`, `TRUSTED_PROXIES`,
`DOWNLOAD_LINK_SECRET`, `APP_PUBLIC_API_URL`. Empty APNs/FCM config = provider is a no-op
(same fail-soft pattern as `NoopProvider{Name: "push"}` in `internal/httpserver/server.go`).

---

## 7. Rollout

### Phase 0 — prerequisites for switching the app to `EXPO_PUBLIC_API_MODE=live` (backend: small)

1. Reverse proxy + `TRUSTED_PROXIES` (§4.3).
2. C3 org-context rotation, C4 logout without access token, C2 families + mobile TTL.
3. C6/C7 `sort`, C8 `tz` + `organizations.time_zone`.
4. Mobile-side (not backend): D1 `MFA_REQUIRED`, D9 drop platform presets, error-code catalog.

### Phase 1 — push notifications

1. `mobile_devices` + N1–N4, APNs/FCM providers, `app:push:send` task.
2. C9 org-scoped inbox + `deep_link`, C10 `push` channel in tenant prefs.
3. `push` channel on existing team kinds (`todo.reminder`, `quote.team_*`), then new
   `job.team_assigned`, `job.team_ready` (+ `jobs.updated` event).
4. C5 sessions show devices; revoke unregisters push.

### Phase 2 — widgets & Live Activities

1. N8 `jobs/today` (+ETag).
2. `live_activity_tokens` + N5–N7, `app:liveactivity:push`, server i18n for live labels.
3. Push-to-start on `jobs.created` for `auto_start` devices.

### Phase 3 — robustness & ops

1. Idempotency middleware (C12) — before enabling any offline write queue in the app.
2. Signed downloads N12–N13.
3. N9–N11 version gate + `426 APP_UPDATE_REQUIRED` middleware.
4. `Accept-Language` middleware + localized error messages (C11).
5. Silent widget refresh pushes (throttled).
6. Universal links: AASA on the web domain (frontend repo), `applinks:` entitlement (mobile).

### Acceptance checklist

Contract & docs
- [ ] Every new/changed route is in `docs/openapi.yaml` in the same PR; `make openapi-lint` passes.
- [ ] Mobile regenerates `src/api/generated/api.d.ts` from the updated spec; `npx tsc --noEmit` passes.
- [ ] A contract smoke test (script) replays every row of §1.4 against a seeded local API with a
      tenant owner + staff token and asserts 2xx/expected 4xx and the envelope shape.

Auth
- [ ] Refresh with an already-rotated token revokes the family (all later refreshes 401).
- [ ] Login → org-context → `GET /v1/auth/sessions` shows **one** session for the phone.
- [ ] Logout with an expired access token revokes the current refresh token (session gone).
- [ ] Mobile session survives 30 days idle; web keeps 7 days.
- [ ] Rate-limit keys use the real client IP behind the proxy; spoofed `X-Forwarded-For` from an
      untrusted peer is ignored.

Push
- [ ] PUT device twice with the same body → one row; switching user on the same phone moves the token.
- [ ] Test push arrives on a TestFlight build (production APNs) and a dev build (sandbox).
- [ ] APNs 410 → `push_token_status = invalid`, no further sends.
- [ ] `todo.reminder` push opens `otopoly://todos/{uuid}` in the right organization.
- [ ] Per-type `push` off in tenant prefs suppresses that kind only; global `push_enabled=false` suppresses all.
- [ ] Impersonation tokens cannot register devices.
- [ ] Logout / session revoke stops pushes to that phone within one request.

Live Activities & widgets
- [ ] Marking a job ready on the web updates the phone's Live Activity within 5 s with the app killed.
- [ ] Delivered/cancelled/voided ends the activity; no pushes after `expires_at`.
- [ ] Props rendered by the server are byte-for-byte what `buildJobActivityProps` produces for the
      same job and locale (golden test with shared fixtures).
- [ ] `GET /v1/tenant/jobs/today` equals `buildTodayProps` numbers for the same data (golden test),
      honours `tz`, returns `304` on unchanged `If-None-Match`.
- [ ] Staff without `tenant.jobs.read` → 403 (widget shows `noAccess`).

Robustness
- [ ] Replayed `POST /v1/tenant/jobs` with the same `Idempotency-Key` returns the same job, creates one row.
- [ ] Same key with a different body → `IDEMPOTENCY_KEY_REUSED`.
- [ ] Signed PDF URL opens in Safari without headers, expires after 5 min (`410 LINK_EXPIRED`).
- [ ] Build below `min_supported_version` gets `426 APP_UPDATE_REQUIRED` on writes; N9 reports
      `update_required`.
- [ ] `Accept-Language: en` returns English `error.message` for catalogued codes.
- [ ] `go test ./...`, `golangci-lint run ./...`, `make sqlc` clean (no diff) in the backend.
