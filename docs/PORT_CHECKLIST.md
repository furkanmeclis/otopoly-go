# Otopoly Mobile — Tenant Port Checklist

Source of truth: web tenant shell `otopoly-go/frontend/src/app/(tenant)/t/[slug]/*` and
`otopoly-go/frontend/src/features/*`. API contract: `otopoly-go/backend/docs/openapi.yaml`.
The mobile app talks to the Go API directly (`/v1/*`, Bearer JWT) — no BFF.
Until the backend is wired, every call is served by the in-app mock (`EXPO_PUBLIC_API_MODE=mock`).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **O** = owner only · **W** = needs write permission

---

## 0. Foundation (every screen depends on these)

### Auth & tenant
- [ ] `POST /v1/auth/login` (email, password, optional `totp_code`) → tokens (no `oid`)
- [ ] `GET /v1/auth/me` → user, roles, permissions, `organizations[]`
- [ ] Organization picker when user has >1 membership; auto-select when exactly 1
- [ ] `POST /v1/auth/organization-context {organization_slug}` → tokens with `oid`
- [ ] Tokens in `expo-secure-store`; refresh (`POST /v1/auth/refresh`) single-flight on 401
- [ ] Re-issue org context on `403 ORGANIZATION_CONTEXT_REQUIRED`
- [ ] Guards (same as web `TenantRouteGuard`): not signed in → login; no membership → denied screen; `access_ends_at` passed or status suspended/expired → expired screen
- [ ] Logout (`POST /v1/auth/logout`) clears tokens + query cache
- [ ] Forgot password (`POST /v1/auth/password/forgot`)
- [ ] 2FA prompt when login returns TOTP required

### RBAC (exact sets from backend migrations)
- [ ] `organization_owner`: 57 permissions (all tenant.* incl. writes, bulk, settings, imports, billing.write, messaging.write)
- [ ] `organization_user` (staff): 34 permissions — read + export everywhere, write only jobs/customers/sales/contracts/leads/quotes/todos
- [ ] Owner-membership gate (`role === "owner"`) for voids, catalog/finance/cari/purchases/suppliers writes, staff write
- [ ] `usePermission()`, `<Can>` component, route-level `RequirePermission` screen with forbidden state
- [ ] Hidden nav items for missing permissions (same as web nav)
- [ ] `409 LIMIT_REACHED` → global limit dialog; `403 FEATURE_DISABLED` → feature-locked state

### API layer
- [ ] `request(method, path, {query, body})` — same signature as web `platformRequest`
- [ ] Envelope unwrap `{success, data, meta.request_id}`; `ApiError` with `code`, `status`, `details[]`, `requestId`
- [ ] `Accept-Language` header from active locale
- [ ] Mock adapter: in-memory seeded DB, realistic latency, real mutations (create/close/void change balances)
- [ ] Mock mirrors server rules (status transitions, owner-only voids, validation errors with `details[]`)
- [ ] Services copied from web feature services (types unchanged)
- [ ] OpenAPI types generated into `src/api/generated/api.d.ts`
- [ ] TanStack Query: keys per module, invalidation after mutations, pull-to-refresh

### Logging & errors
- [ ] `logger` with levels (debug/info/warn/error), scopes, ring buffer, dev console
- [ ] Every request logged: method, path, status, duration, request_id (no tokens/passwords)
- [ ] Every mutation success/failure logged; navigation logged
- [ ] Global JS error handler + unhandled promise rejection handler
- [ ] Root + per-route `ErrorBoundary` with retry, logs the error
- [ ] Sink interface ready for remote (Sentry/own backend) — not wired yet
- [ ] In-app diagnostics screen (owner/dev) to view/share recent logs

### Theme (light/dark)
- [ ] Token sets for light + dark (brand `#EA6E43`)
- [ ] Mode: system / light / dark, persisted; StatusBar + navigation theme follow
- [ ] No raw hex in screens; all styles via `useTheme()`
- [ ] Charts, badges, status colors readable in both modes

### i18n (tr / en, backend-ready)
- [ ] Same JSON catalogs as web (`src/locales/{tr,en}/*.json`), same keys, same `t()` semantics (`ns.key`, `{{param}}`, `_one/_other`)
- [ ] Locale: device default → user `locale` from `/me` → user choice (persisted, `PATCH /v1/auth/profile {locale}`)
- [ ] Money/date/number formatting via `Intl` with active locale (TRY)
- [ ] Missing-key logging in dev
- [ ] RTL-ready layout (no hard left/right where start/end fits)

### UI kit (themed)
- [ ] Screen, Header, Card, Button, IconButton, Badge, StatusBadge, Input, TextArea, Select/Picker sheet, DateField, MoneyInput, Switch, Segmented, SearchBar, FilterChips, ListItem, EmptyState, ErrorState, Skeleton, Toast, ConfirmDialog, BottomSheet, Avatar, PlateBadge, Amount, KPI tile, FAB
- [ ] Keyboard-safe forms, validation messages from API `details[]`

---

## 1. Navigation shell
- [ ] Tabs: Ana Sayfa · İşlemler · Müşteriler · Finans · Menü (items filtered by permission)
- [ ] Menü mirrors web nav groups: Tenant / Finans / Müşteriler / Katalog / İçe-Dışa aktarım / Ayarlar
- [ ] Nav badges: todos (overdue/today), leads, quotes (web `*NavAdornment`)
- [ ] Subscription banner (trial/expiring) + limit-reached dialog
- [ ] Assistant launcher (if `tenant.ai.use`)

## 2. Dashboard (`/t/{slug}`) — `tenant-dashboard.tsx`
- [ ] KPIs: income, net, avg ticket, vehicles (last N days)
- [ ] Today: collected, delivered, card/cari split, job count
- [ ] Queue: in-progress + ready jobs (open board)
- [ ] Unpaid jobs, receivables (cari), top customers, top services
- [ ] Revenue chart (timeseries)
- [ ] Setup checklist (onboarding progress, dismiss)
- [ ] Quick actions: new job, quick sale, open reports

## 3. Operations / Jobs — `tenant.jobs.*`
- [ ] Board by status (in_progress / ready / delivered) + list view
- [ ] Filters: status, assignee, unpaid only, show closed, date, search plate/customer
- [ ] Daily summary (job count, card, cari, net, paid)
- [ ] Board card: plate, brand mark, services color tags, elapsed time, assignee, amount, paid badge
- [ ] Create job **W**: customer picker (+ inline create), vehicle picker (+ add vehicle from catalog), services (catalog), price/qty override, assignee, notes, start time
- [ ] Detail: info, lines, payments, consumptions (material cost), contracts section, linked todos
- [ ] Actions **W**: ready, deliver, close (cash/card → account, cari), cancel, edit notes, change assignee
- [ ] Void **O**
- [ ] Consumptions **W**: add product, change qty, remove
- [ ] Export (jobs.export) — mobile: share file

## 4. Customers — `tenant.customers.*`
- [ ] List: search, kind filter, active filter, vehicle count, cari balance
- [ ] Create/edit **W**: name, phone, email, kind, tax id/office, notes, active, first vehicle
- [ ] Detail: info, vehicles (add from catalog search / remove), recent jobs, cari balance + recent entries, quotes/leads/todos links
- [ ] Delete **W** (blocked when cari balance ≠ 0)

## 5. Cari — `tenant.cari.*`
- [ ] Summary: total receivable, account count, with balance
- [ ] List: search, has balance, active
- [ ] Detail: statement (entries with type/status/date filters)
- [ ] Charge / Payment (→ finance account, method) / Adjustment (increase/decrease) **O**
- [ ] Void entry **O**; export statement

## 6. Finance — `tenant.finance.*`
- [ ] Summary: date range, income/expense/net, accounts with balances, expense by category, recent transactions, quick links
- [ ] Accounts list + detail (stats, recent transactions); create/edit/delete **O**
- [ ] Transactions list: type/status/account/category/date filters; detail with source card (job/sale/purchase/cari)
- [ ] New income / new expense / new transfer **O**; void **O**
- [ ] Categories list + detail; create **O**

## 7. Sales — `tenant.sales.*`
- [ ] List + daily summary; filters status/date
- [ ] Quick sale **W**: optional customer, products (stock aware), qty/price, method (cash/card → account, cari requires customer)
- [ ] Detail; void **O**

## 8. Suppliers — `tenant.suppliers.*`
- [ ] List/search/active; detail; create/edit/delete **O** (delete blocked with purchases)

## 9. Purchases — `tenant.purchases.*`
- [ ] List (with lines); filters; detail
- [ ] Create **O**: supplier, products, unit cost, qty, method, account, date; void **O**

## 10. Catalog — `tenant.catalog.*`
- [ ] Products: list (category/stock status/active/tracked filters), detail, create/edit **O**, stock adjustment **O**, delete **O**
- [ ] Services: list, detail, create/edit **O** (color palette), recipe products (set products **O**), delete **O**
- [ ] Categories: list (product/service), detail, create/edit/delete **O**
- [ ] Catalog summary (stock values, low/out of stock)
- [ ] Bulk actions **O** (activate/deactivate/delete/raise price/adjust stock) — mobile: multi-select

## 11. Leads — `tenant.leads.*`
- [ ] List: status/temperature/source/assignee/follow-up filters, summary
- [ ] Create/edit **W**: customer picker, source, temperature, follow-up, assignee
- [ ] Detail: timeline (events), notes, status + temperature toggles, create todo, create quote, delete

## 12. Quotes — `tenant.quotes.*`
- [ ] List: status filter, summary / pipeline widget
- [ ] Editor **W**: customer/lead, vehicle, lines (service/product/custom), line discount %, quote discount, VAT incl/excl, validity, notes — totals computed like server
- [ ] Detail: status timeline, deliveries (retry), reminders, share link, PDF (open/share)
- [ ] Send **W** (preview, channel), set status, duplicate, convert to job (preview → missing fields)

## 13. Todos — `tenant.todos.*`
- [ ] Scopes: overdue / today / upcoming / no date / done; assignee filter; search
- [ ] Create/edit **W**: title, notes, due, reminders, assignee, links (customer/lead/quote)
- [ ] Complete / reopen / delete; summary for nav badge

## 14. Staff — `tenant.staff.*`
- [ ] List (status, role)
- [ ] Create **O** (name, surname, email, password), activate/deactivate **O**, reset password **O**

## 15. Reports — `tenant.reports.*`
- [ ] Filters: date range, granularity, currency, payment method, account, source
- [ ] KPIs, timeseries chart, services/products mix, income/expense categories, payment methods, sources, cari receivables, top customers
- [ ] Export (reports.export) — share file

## 16. Contracts — `tenant.contracts.*`
- [ ] Instances list + detail (signers, status, PDF)
- [ ] On-site signing with signature pad, WhatsApp OTP verify
- [ ] Templates list/detail; clone preset **O**; void **O**

## 17. Settings
- [ ] Letterhead / export settings **O** (`tenant.settings.*`)
- [ ] Messaging (WhatsApp session, templates, notification rules, daily summary, vehicle alerts)
- [ ] Billing: overview, plans, usage meters, checkout/order, report payment, invoices, invoice profile

## 18. I/O
- [ ] Exports list + detail (download/share)
- [ ] Imports list + detail **O** (wizard is desktop-heavy — mobile: view + status)

## 19. Profile
- [ ] Profile edit (name, surname, locale), change password
- [ ] Preferences: theme, language, notification preferences (`/v1/tenant/notification-preferences`)
- [ ] Sessions (list, revoke, revoke others), 2FA status

## 20. Assistant — `tenant.ai.use`
- [ ] Conversations list, chat (SSE stream), confirm cards, tool activity

---

## Per-screen QA (run on every screen before ticking it)
- [ ] Loading skeleton, empty state, error state with retry, forbidden state
- [ ] Pull-to-refresh; pagination / infinite scroll where lists can grow
- [ ] Light + dark visually checked
- [ ] tr + en checked (no hard-coded strings, long text wraps)
- [ ] Owner and staff demo users checked (hidden/disabled actions, forbidden screen)
- [ ] Mutations: optimistic or spinner, success toast, error toast with API message, cache invalidated
- [ ] Logs present for load, action, error
- [ ] Safe areas, keyboard, small screen (SE) and tablet layout
- [ ] Touch targets ≥ 44pt, accessibility labels on icon buttons
- [ ] `npx expo lint` and `npx tsc --noEmit` clean

## Brand & iOS widgets

- [x] Brand assets in `assets/brand/` (mark, reversed mark for dark mode, app-icon tile, widget tile)
- [x] Brand mark on native splash (light/dark), boot view, login, org picker, dashboard, menu footer
- [x] `expo-widgets` config: extension `com.otopoly.app.widgets`, App Group `group.com.otopoly.app`, iOS 17.0
- [x] **Otopoly · Bugün** home-screen widget: small / medium / large, light & dark, live queue timers, deep links
- [x] **Otopoly · Kilit Ekranı** lock-screen widget: circular / rectangular / inline
- [x] **Job Live Activity** (Lock Screen + Dynamic Island) with toggle on job detail; auto-updated on status change, ended on delivery/cancel/void
- [x] Widgets use the dashboard queries (no extra requests); `jobs.read` gate → "no access" card
- [x] Sign-out wipes widget figures and ends Live Activities; org switch ends Live Activities
- [x] Expo Go / Android: bridge is a no-op (native module check), no crash
- [x] Stringified widget code verified: parses, self-contained, renders 80 family/scheme/state combinations
- [ ] Device QA on TestFlight: add each widget size, Lock Screen widgets, Live Activity start → ready → deliver
