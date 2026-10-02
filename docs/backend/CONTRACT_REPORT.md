# Mobile ↔ Go API contract report (wave 4, step 1)

Date: 2026-10-02 · Branch: `feat/contract-conformance` (on top of `feat/store-audit`, PR #8)

## What was checked

`npm run test:contract` (also in CI) proves, without a running backend, that the mock API and the feature
services speak the Go API's contract:

- **Spec**: `scripts/contract/openapi.yaml` = otopoly-go `backend/docs/openapi.yaml`, 3-way merged from
  `feat/identity-native-link` @ `872e194` (main + auth + QR + identities) and `feat/expo-push-limits` @ `569bc63`
  (push devices, usage meters, `LIMIT_REACHED`). Merge base `887d7d5`, no conflicts. Rebuild with
  `scripts/contract/refresh-spec.sh`.
- **Backend fixtures** (from the same SHAs): `backend-error-codes.json` (every error code the Go code can emit) and
  `backend-routes.json` (every `mux.Handle` route), used to tell *spec gaps* (route exists, undocumented) from
  *missing backend endpoints*.
- **Driver** `scripts/contract/drive.ts` calls the real feature services with the bodies the screens send, area by
  area, plus the main error cases (validation, not found, conflict, forbidden, limit reached, bad codes/tokens).
  All 12 mock smoke suites run under the same recorder for extra traffic.
- **Validator** `scripts/contract/validate.mjs` (Ajv 2020-12 + ajv-formats, OpenAPI 3.1 schemas used as-is) checks for
  every exchange: endpoint exists, query params match their schema, request body matches the request schema
  (JSON or multipart field names), status code is documented, success/error envelope, response body against the
  response schema, error code exists in the backend, `LIMIT_REACHED` details shape.
- **Known exceptions** live in `scripts/contract/allowlist.json`, each with a reason (spec bugs and undocumented
  statuses the Go handlers really return). Any new violation fails CI.

### Coverage

757 recorded exchanges · **246 app endpoints** (every mock route + every path a service calls) ·
**245 exercised (99.6 %)** · **244 in the spec**, 2 in the Go router but not in the spec · **0 contract errors**.
Not exercised: `GET /v1/tenant/exports/{uuid}/download` (binary download, goes through the file helper, not JSON).

| Area | Endpoints | In spec | Exercised | Response schema checked | Request schema checked |
|---|---:|---:|---:|---:|---:|
| dashboard (reports) | 3 | 3 | 3 | 1 | 1 |
| jobs | 16 | 16 | 16 | 0 ¹ | 6 |
| customers | 10 | 10 | 10 | 0 ¹ | 2 |
| finance (+ cari) | 36 | 34 | 36 | 15 | 12 |
| commerce (sales, purchases, suppliers) | 20 | 20 | 20 | 0 ¹ | 7 |
| CRM (quotes, leads, todos) | 31 | 31 | 31 | 31 | 12 |
| catalog | 22 | 22 | 22 | 18 | 8 |
| documents (contracts, imports, exports) | 27 | 27 | 26 | 22 | 8 |
| settings (settings, staff, messaging, daily summary, vehicle alerts) | 26 | 26 | 26 | 7 | 9 |
| AI assistant | 9 | 9 | 9 | 7 | 4 |
| auth | 25 | 25 | 25 | 24 | 15 |
| notifications (+ push devices, preferences) | 14 | 14 | 14 | 14 | 4 |
| billing (usage) | 1 | 1 | 1 | 1 | 0 |
| QR login | 6 | 6 | 6 | 6 | 2 |

¹ The spec documents these responses with a description only (no schema). Envelope, status codes and error
shapes are still validated. As a one-off, the mock payloads were also compared with the Go structs' `json` tags
(`jobs.Job/JobDetail/Line/Summary`, `customers.Customer/CustomerDetail/Vehicle`, `sales.SaleDetail/Summary`,
`purchases.Purchase/PurchaseDetail`, `suppliers.Supplier`, `staff.Member/MemberOption`,
`cari.Account/AccountDetail/Entry/Summary`): **field names match 1:1**. The only difference is that the mock sends
`null` where Go omits `omitempty` pointer fields (`completed_at`, `voided_at`, `cari_balance`, `logo_url`, …);
the app types declare all of them `?: T | null`, so this is harmless.

Not covered by the JSON contract: public quote pages (`/v1/public/quotes/*`, plain `fetch`, no mock), PDF/XLSX
downloads and the AI SSE streams (see below).

## Mismatches fixed in this PR

| Area | Mismatch | Fix |
|---|---|---|
| all | Success statuses: the mock answered 200 for 43 routes where Go answers **201 Created / 202 Accepted** (finance, cari, catalog, contracts, exports, imports, AI conversations, QR sessions, notification test, quote duplicate/convert, lead notes/todo, vehicles…) | `src/api/mock/status.ts` table mirrors the Go handlers; regex hack removed |
| all lists | `GET …/meta` returned `{resource, capabilities}` with mock names (`jobs`, `finance.accounts`, `sortable`) | `resourceMeta()` helper returns the Go `resourcemeta.ResourceMeta` shape (`tenant.jobs`, `default_sort`, 10 capability flags, `*_fields`); app `ResourceMeta` type fixed |
| documents | Export job status `pending` — backend uses `queued \| processing \| completed \| failed \| expired`. **App bug**: `isExportRunning` checked `pending`, so live exports would never be polled | app + mock use `queued` |
| documents | Import state errors were `409 CONFLICT`; Go answers `400 VALIDATION_ERROR` (rollback of a non-applied job). Export download before completion: `404` in Go | mock aligned, smoke tests updated |
| documents | Contract signers sent `otp_channel: ""`, `otp_phone_masked: ""`, `otp_verified_at: null`; Go omits them (`omitempty`) and the spec enum is `whatsapp \| sms` | mock omits them |
| auth | `GET /v1/auth/me` `links` was `{}`; spec requires `profile`, `change_password`, `notification_preferences` | mock fills them |
| auth | `GET /v1/public/organizations/by-slug/{slug}` lacked `status` | mock + `PublicOrganization` type |
| auth | Wrong current password on `POST /v1/auth/password/change`: mock `400 VALIDATION_ERROR`, Go **`401 INVALID_CREDENTIALS`**. Live, the client would have treated that 401 as an expired token and refreshed + retried | mock aligned; client only refreshes on `401 UNAUTHENTICATED` (or no code); password screen shows the error on the current-password field (new i18n key) |
| auth | `403 ACCOUNT_DISABLED` does not exist in Go (disabled user → `403 FORBIDDEN "User is disabled"`) | mock aligned, dead branch removed from `auth-errors.ts` |
| account | `409 IDENTITY_ALREADY_LINKED` does not exist; Go answers `409 CONFLICT` both for "linked to another account" and "account already has a different Apple/Google sign-in" | mock aligned; `identityErrorKey(code, message)` tells the two apart by message |
| notifications | Bad/expired signed action link: mock `INVALID_SIGNATURE` / `ACTION_EXPIRED`; Go `400 VALIDATION_ERROR` | mock aligned (the app already retries with a fresh signature) |
| billing | `LIMIT_REACHED` details lacked `owner_notified`; overview lacked `open_order` (always present, `null`) | mock sends both; `limitInfo()` parses `ownerNotified` |
| commerce | `409 INSUFFICIENT_STOCK` does not exist; Go: `409 CONFLICT "insufficient stock for …"` | mock aligned |
| settings | Vehicle-alert test without recipients: mock `409 NO_RECIPIENTS`; Go `400 VALIDATION_ERROR` | mock aligned |
| finance | Transactions sent `null` for `source_uuid`, `category_*`, `counter_account_*`, `reference_no`, `voided_at`; `source_detail: null` on manual rows. Go omits them and the spec types them non-nullable | mock omits them (`txnOut`) |
| QR | `POST /v1/auth/qr/exchange` returned `user.email: ""` (spec: `format: email`) | mock returns the approving user |
| core | Crash fallback code `INTERNAL` → Go's `INTERNAL_ERROR` | mock aligned |

## Spec gaps (backend has it, `openapi.yaml` does not say so)

None of these block the switch; they should be fixed in otopoly-go's `openapi.yaml` (then drop the allowlist entry):

- `PATCH` / `DELETE /v1/tenant/finance/categories/{uuid}` — routes exist (`finance/routes.go:48-49`), not in the spec.
- Multipart bodies undocumented: `POST /v1/tenant/finance/accounts/import`, `POST /v1/tenant/finance/categories/import`,
  `PUT /v1/tenant/settings/logo` (fields `file`, `format`, `locale`).
- JSON bodies undocumented: `PATCH /v1/tenant/customers/{uuid}`, `PATCH /v1/tenant/imports/{uuid}/mapping` (`mapping`, `defaults`).
- Undocumented statuses the Go handlers return: `400` on `POST /v1/tenant/customers` and `POST /v1/tenant/jobs/export`,
  `409` on `POST /v1/tenant/catalog/products|categories` (duplicates).
- Undeclared query params the app sends: `is_active` on `GET /v1/tenant/finance/categories`, `currency` on
  `GET /v1/tenant/finance/transactions` (handled by Go).
- Response schemas missing entirely for jobs, customers, sales, purchases, suppliers, staff, cari (see ¹).
- **Spec bug**: `AIUIBlock.data` is `oneOf [AIConfirmCard, AIPlan, {type: object}]` — a valid card or plan matches two
  branches, so no confirm/plan block can ever validate. Should be `anyOf` (patched in memory via `allowlist.json`).
- `ErrorBody.code` examples list only auth codes; module codes (`WHATSAPP_NOT_CONNECTED`, `NO_RECIPIENT_PHONE`,
  `OTP_REQUIRED`, `INVALID_OTP_CODE`, `AI_*`, `QR_*`, `LIMIT_REACHED`, …) are not catalogued in `docs/api/errors.md`.

## Endpoints missing in the backend

**None for what the app calls today**: every endpoint the services or mock routes use exists in the Go router at the
SHAs above. Known, deliberate absences (the app does not offer these, so nothing to build yet):

- Catalog import/export (`POST /v1/tenant/imports`, `POST /v1/tenant/exports` for `tenant.catalog.*`) — the web
  toolbar points there but Go has no route; mobile leaves catalog out of the import/export sheets.
- The mock's AI chat and action confirm answer JSON; **Go answers `text/event-stream`** for
  `POST /v1/tenant/ai/conversations/{uuid}/messages` and `POST /v1/tenant/ai/actions/{uuid}/confirm`. The app needs an
  SSE reader before AI goes live (reported as a "live blocker" warning by the contract test).

## Open app follow-ups

- `owner_notified` is now parsed but the staff limit dialog still always says "your manager has been notified";
  add a copy for `owner_notified=false` (product decision, see ROADMAP).
- Public quote pages use `fetch` directly and are not mocked; test them against staging.

## Recommended order to switch from mock to live

Go area by area behind `EXPO_PUBLIC_API_MODE`, simplest and most schema-covered first; run `test:contract` after every
backend spec refresh.

1. **auth + QR + notifications/push + billing usage** — fully schema-validated (24/25, 6/6, 14/14, 1/1), no write side
   effects on business data; required for everything else. Verify Apple/Google native sign-in and Centrifugo QR
   end-to-end on staging.
2. **dashboard (reports overview, jobs/sales/finance summaries) and catalog** — read-heavy, catalog has 18/22 response
   schemas.
3. **CRM (quotes, leads, todos)** — 31/31 response schemas; types already generated from the spec.
4. **customers and jobs** — core flow; no response schemas in the spec, but field names verified against Go structs.
   Switch together (job creation needs customers/vehicles).
5. **finance + cari, then commerce (sales, purchases, suppliers)** — money movements; verify balances against the web on
   the same tenant after switching.
6. **settings (staff, messaging/WhatsApp, daily summary, vehicle alerts, export settings) and documents (contracts,
   imports, exports)** — depend on WhatsApp/storage/Gotenberg in the target environment; multipart uploads have no
   spec coverage, test by hand.
7. **AI assistant last** — needs the SSE client first.
