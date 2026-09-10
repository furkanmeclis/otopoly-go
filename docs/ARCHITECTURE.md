# Architecture

This repo is a two-app monorepo plus Compose files. Dependencies point inward: HTTP handlers and Next.js pages call use cases / services; they do not own SQL or SMTP.

## Layout

```
.
├── backend/                      Go API + worker
│   ├── cmd/                      server, worker, create-super-admin
│   ├── internal/modules/         auth, notifications, exports, imports,
│   │                             bulk, settings, activity, logs, storage,
│   │                             access, search, integrations
│   ├── internal/platform/        jwt, rbac, events, storage, mail, outbox,
│   │                             ioengine, bulkengine, activity, resourcemeta,
│   │                             stepup, searchengine, crypto
│   ├── migrations/               sequential golang-migrate SQL
│   └── docs/openapi.yaml         OpenAPI 3.1 (Scalar at /docs/)
├── frontend/                     Next.js BFF
│   ├── src/app/(platform)        /platform admin
│   ├── src/app/(public)            / landing + /register
│   ├── src/app/(tenant)            /t/{slug} business shell
│   ├── src/app/(cms)               legacy CMS shell (profile aliases)
│   ├── src/app/(guest)             login, reset, verify
│   ├── src/app/api/v1            BFF proxy → Go
│   └── src/features/             users, roles, organizations, notifications, io, bulk-engine,
│                                 storage, logs, nav-engine, step-up-engine,
│                                 search-engine, access, integrations, account, auth
├── compose.local.yml             infra only
└── compose.prod.yml              full stack
```

## Shells

| Surface | Path | Who |
|---------|------|-----|
| Public | `/`, `/register` | Signed-out visitors; self-service business registration |
| Tenant | `/t/{slug}` | Organization owners/staff (`organization_members`) |
| Platform | `/platform` | `super_admin` or any `platform.*` permission |
| CMS | `/profile` (legacy) | Redirects / aliases; tenant users use `/t/{slug}/profile` |
| Guest | `/platform/login` (aliases also exist at `/login`) | signed-out users |

JWT claims are `sub`, `roles`, `is_super_admin`, `exp`, optional `imp` (impersonator), optional `sid` (refresh session), optional `oid` (active organization UUID when logging in with `organization_slug`). No workspace / `wid` claim.

## Tenant model

- **Organizations** are businesses (tenants). Each has a unique `slug`, trial `access_ends_at`, and `status` (`pending`, `active`, `suspended`, `expired`).
- **Self-register** at `POST /v1/public/organizations/register` creates `users` + `organizations` + `organization_members(role=owner)` in one transaction, then the frontend signs in and redirects to `/t/{slug}/`.
- **Staff** are assigned only by platform admins (`POST /v1/platform/organizations/{uuid}/members`). Businesses cannot invite staff themselves in this MVP.
- **Login** accepts optional `organization_slug`. When set, the API validates membership and access before issuing a JWT with `oid`.
- **`/v1/auth/me`** returns `organizations[]` with `uuid`, `slug`, `name`, `role`, `logo_url`, `status`, `access_ends_at`.
- **Tenant shell** (`/t/{slug}/*`) loads public branding via `GET /v1/public/organizations/by-slug/{slug}` and guards session + membership + `access_ends_at`.
- **Platform admin** manages organizations at `/platform/organizations` (`platform.organizations.read` / `.write`).

There is **no** workspace or multi-branch model in this MVP.

## Tenant finance (`/t/{slug}/finance`)

Organization-scoped accounting under `/v1/tenant/finance/*`. Requires JWT `oid` (login with `organization_slug`) plus membership.

| Permission | Who | Notes |
|------------|-----|-------|
| `tenant.finance.read` | `organization_user` (owners + staff) | Lists, summary, balances |
| `tenant.finance.write` | `organization_owner` role + owner membership | Create accounts, categories, transactions, transfers, void |
| `tenant.finance.export` | `organization_user` (owners + staff) | PDF/XLSX/CSV/JSON from finance lists |
| `tenant.finance.import` | `organization_owner` | Create-only import of accounts and categories (not ledger rows) |
| `tenant.settings.read` / `.write` | `organization_owner` | Organization letterhead used in PDF/XLSX |
| `tenant.imports.read` | `organization_owner` | Tenant import job list / mapping / rollback |

**Roles:** `organization_owner` is assigned to `organization_members.role = owner` and grants write. Staff keep read-only via `organization_user` + `.read` only.

**Core tables:** `finance_accounts`, `finance_categories`, `finance_transactions` (all scoped by `organization_id`).

Tenant export (`POST /v1/tenant/finance/{accounts,categories,transactions}/export`) stamps `export_jobs.organization_id`. Tenant import (`POST /v1/tenant/finance/{accounts,categories}/import`) stamps `import_jobs.organization_id`. PDF/XLSX letterhead is built from the organization row (`name`, logo, address, phone, city/district, plus owner-managed tagline/email/website/footer/color/paper size). Empty chrome fields fall back to platform `app_settings`. Job lists: `GET /v1/tenant/exports` and `GET /v1/tenant/imports`. Letterhead UI: `GET/PATCH /v1/tenant/settings` (owner).

**Integration hooks (future modules):** `finance_transactions.source_type` + `source_uuid` link external domain events without duplicating money rows.

| `source_type` | Future use |
|---------------|------------|
| `manual` | User-entered income/expense/transfer (MVP default) |
| `cari_payment` | Cari collection posted from tenant cari module |
| `service_job` | Car-wash job payment posted on close |
| `product_sale` | Quick product sale from operations module |
| `purchase` | Stock purchase / supplier expense |

Optional `metadata` JSONB carries module-specific flags. Open receivable is modeled as a `cari` charge (positive balance); do not use `pending_receivable` once the cari module is active.

## Tenant cari (`/t/{slug}/cari`)

Organization-scoped accounts receivable under `/v1/tenant/cari/*`. One `cari_accounts` row per customer (auto-created). Positive `balance` means the customer owes the business.

| Permission | Who | Notes |
|------------|-----|-------|
| `tenant.cari.read` | `organization_user` (+ owner) | Lists, summary, statements |
| `tenant.cari.write` | `organization_owner` + owner membership | Charge, payment, adjustment, void |
| `tenant.cari.export` | owners + staff | Account list and statement export |

**Core tables:** `cari_accounts`, `cari_entries` (scoped by `organization_id`).

**Flows:**
- **Charge** — increases receivable (no cash movement).
- **Payment (tahsilat)** — decreases receivable and posts `finance_transactions` income with `source_type=cari_payment` and `source_uuid` = cari entry UUID (category **Cari Tahsilat**).
- **Void** — reverses cari balance; payment voids also void the linked finance row via source.

Customers with non-zero cari balance cannot be soft-deleted.

## Request flow

```
Browser
  → same-origin /api/v1/*          Next.js BFF (HttpOnly session)
  → $API_URL/...                   Go API (Bearer JWT)
  → use case → repository (sqlc)   PostgreSQL
```

- Access and refresh tokens never enter JavaScript. The BFF stores them in HttpOnly cookies and strips them from JSON responses.
- NextAuth is the frontend session layer; the Go adapter talks to `/v1/internal/auth/*`.
- OpenAPI types are generated into `frontend/src/generated/api.d.ts` via `pnpm api:generate`.

## Backend layers

```
handler → usecase → repository interface → sqlc/pgx → PostgreSQL
```

Cross-module signals go through `internal/platform/events` (in-process, fail-soft). Handlers never call SMTP or SMS; they enqueue via the notification service (`app:notification:deliver` on the `notifications` queue).

Audit: `activity.Recorder.Record` (fail-soft). Application logs: `internal/modules/logs`.

## Platform engines

| Engine | Package | Job |
|--------|---------|-----|
| Resource meta | `internal/platform/resourcemeta` | `GET /v1/.../meta` — columns, filters, capabilities |
| I/O | `internal/platform/ioengine` | Export / import adapters; jobs on Asynq `exports` / `imports` |
| Bulk | `internal/platform/bulkengine` | Batch mutations; jobs on Asynq `bulk` |
| Search | `internal/platform/searchengine` | Meilisearch indexing + `GET /v1/search` for Cmd+K |
| Storage | `internal/platform/storage` + `modules/storage` | Object bytes in MinIO/S3; metadata in Postgres |
| Activity | `internal/platform/activity` | Audit events for mutations and I/O |
| Step-up | `internal/platform/stepup` | Re-auth grant (password/passkey) before sensitive routes |
| Secrets | `internal/platform/crypto` | AES-256-GCM box for GitHub App credentials |

Adapters register in `internal/httpserver/server.go` and `cmd/worker/main.go`.

## Data stores

| Store | Role |
|-------|------|
| PostgreSQL 18 | Source of truth |
| Redis | Cache, Asynq, ephemeral state |
| MinIO / S3 | Object bytes; metadata stays in Postgres |
| Meilisearch | Cmd+K record search; HMAC/master key stays on the API |
| Centrifugo | Websocket fan-out; HMAC stays on the API |

Media: the browser must only use API-returned `public_url` / stream paths. See `frontend/src/lib/media/urls.ts`.

## RBAC

Users are global. Permissions are the union of assigned roles.

| Seed role | Notes |
|-----------|--------|
| `super_admin` | System role (`is_system=true`). Created by `make create-super-admin`, not a user column. |
| `organization_user` | System role for business owners/staff (`auth.session`, `notifications.read`) |

Custom roles and permission assignment live under `/v1/platform/roles`. New permission slugs are added only via migrations. Details: [backend/docs/auth.md](../backend/docs/auth.md).
