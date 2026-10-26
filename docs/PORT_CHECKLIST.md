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
- [x] Guards (same as web `TenantRouteGuard`): not signed in → login; no membership → denied screen; `access_ends_at` passed or status suspended/expired → expired / paused screen (`TenantAccessGate`, neutral owner/staff copy, no purchase wording; blocked orgs in the picker open the same state)
- [ ] Logout (`POST /v1/auth/logout`) clears tokens + query cache
- [ ] Forgot password (`POST /v1/auth/password/forgot`)
- [ ] 2FA prompt when login returns TOTP required

### RBAC (exact sets from backend migrations)
- [ ] `organization_owner`: 61 permissions (all tenant.* incl. writes, bulk, settings, imports, billing.write, messaging.write, calendar read/write, reviews read/write)
- [ ] `organization_user` (staff): 37 permissions — read + export everywhere (incl. reviews), write only jobs/customers/sales/contracts/leads/quotes/todos/calendar
- [ ] Owner-membership gate (`role === "owner"`) for voids, catalog/finance/cari/purchases/suppliers writes, staff write
- [ ] `usePermission()`, `<Can>` component, route-level `RequirePermission` screen with forbidden state
- [ ] Hidden nav items for missing permissions (same as web nav)
- [x] `409 LIMIT_REACHED` → global limit dialog (`LimitReachedHost`, API error bus; owner/staff copy, Close + "Kullanımı gör"); `403 FEATURE_DISABLED` → shared `FeatureLockedState` (reports, contracts, contract templates, assistant, quotes + leads via `QuotesModuleGate`); `403 SUBSCRIPTION_READ_ONLY` → same plan dialog with read-only copy

### API layer
- [ ] `request(method, path, {query, body})` — same signature as web `platformRequest`
- [ ] Envelope unwrap `{success, data, meta.request_id}`; `ApiError` with `code`, `status`, `details[]`, `requestId`
- [ ] `Accept-Language` header from active locale
- [ ] Mock adapter: in-memory seeded DB, realistic latency, real mutations (create/close/void change balances)
- [ ] Mock mirrors server rules (status transitions, owner-only voids, validation errors with `details[]`)
- [ ] Services copied from web feature services (types unchanged)
- [ ] OpenAPI types generated into `src/api/generated/api.d.ts`
- [ ] TanStack Query: keys per module, invalidation after mutations, pull-to-refresh
- [x] Live lists (Centrifugo, `centrifuge` JS SDK): one connection per signed-in organization (`LiveHost`), tokens from `/v1/realtime/connection-token` + `/subscription-token`, `org:{org_uuid}:resource:{resource}` channels; `useLiveResource()` on list + detail screens invalidates the matching keys (debounced 400 ms; details only when their uuid is in the event, `lib/realtime/live-targets.ts`); paused in the background, one refetch after reconnect / foreground; fail-soft on 403 / 503 / no network; silent mock driver in demo mode (`scripts/smoke/live.smoke.ts`); `EXPO_PUBLIC_REALTIME=off` disables it

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
- [x] Keyboard-safe forms (react-native-keyboard-controller: `Screen` / `Sheet` use `KeyboardScroll` + `KeyboardFooter`; chat layouts `KeyboardAvoider`), validation messages from API `details[]`

---

## 1. Navigation shell
- [ ] Tabs: Ana Sayfa · İşlemler · Müşteriler · Finans · Menü (items filtered by permission)
- [ ] Menü mirrors web nav groups: Tenant / Finans / Müşteriler / Katalog / İçe-Dışa aktarım / Ayarlar
- [ ] Nav badges: todos (overdue/today), leads, quotes (web `*NavAdornment`)
- [~] Subscription banner (trial/expiring) + limit-reached dialog — dialog done; no banner (no purchase CTA allowed)
- [ ] Assistant launcher (if `tenant.ai.use`)

## 2. Dashboard (`/t/{slug}`) — `tenant-dashboard.tsx`
- [ ] KPIs: income, net, avg ticket, vehicles (last N days)
- [ ] Today: collected, delivered, card/cari split, job count
- [ ] Queue: in-progress + ready jobs (open board)
- [ ] Unpaid jobs, receivables (cari), top customers, top services
- [ ] Revenue chart (timeseries)
- [x] Setup checklist (onboarding progress, dismiss): `features/onboarding/components/setup-checklist.tsx`, progress per user+org on device, skip by long press, Menu → "Başlangıç rehberi" brings it back
- [ ] Quick actions: new job, quick sale, open reports

## 3. Operations / Jobs — `tenant.jobs.*`
- [ ] Board by status (in_progress / ready / delivered) + list view
- [ ] Filters: status, assignee, unpaid only, show closed, date, search plate/customer
- [ ] Daily summary (job count, card, cari, net, paid)
- [ ] Board card: plate, brand mark, services color tags, elapsed time, assignee, amount, paid badge
- [ ] Create job **W**: customer picker (+ inline create), vehicle picker (+ add vehicle from catalog), services (catalog), price/qty override, assignee, notes, start time
- [x] Detail: info, lines, payments, consumptions (material cost), contracts section, linked todos — 360: brand logo, customer / call / WhatsApp / SMS, total / material / margin tiles, every line, product, payment and customer opens its record
  - [x] Contracts section (web `JobContractsSection`): job's contracts (status, signed/total, PDF), create with vehicle photos (camera/library) → sign every pending signer in one sheet
- [ ] Actions **W**: ready, deliver, close (cash/card → account, cari), cancel, edit notes, change assignee
- [ ] Void **O**
- [ ] Consumptions **W**: add product, change qty, remove
- [ ] Export (jobs.export) — mobile: share file

## 4. Customers — `tenant.customers.*`
- [ ] List: search, kind filter, active filter, vehicle count, cari balance
- [ ] Create/edit **W**: name, phone, email, kind, tax id/office, notes, active, first vehicle
- [x] Detail: info, vehicles (add from catalog search / remove), recent jobs, cari balance + recent entries, quotes/leads/todos links — 360: sales (`customer_uuid` filter), contracts on its jobs (`customer_uuid` filter), stat tiles, call / WhatsApp / SMS / email / new job / quote / lead
  - [x] Aktivite timeline (`GET /v1/tenant/customers/{uuid}/activity`): web `activity` action labels, subject + record + actor + relative time, tap → job / sale / quote / lead / contract / cari statement, "load more", live refresh from every listed module
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
- [x] Supplier 360: purchases via `supplier_uuid` filter, totals over posted purchases

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

## 13b. Calendar — `tenant.calendar.*`
- [x] `/calendar` (Menu → Takvim, `tenant.calendar.read`): month grid with a dot per layer colour + selected day agenda, 3-day timeline (lanes for overlaps, now line, tap an hour to add), 30-day agenda list; layer chips (colour / icon / count, remembered per device); pull-to-refresh; live refresh from the module channels
- [x] Tap → source record (job, todo, quote, lead, sale, purchase, contract, finance list) or the event detail sheet; long press → reschedule movable items (events keep their length, todos date + optional time, leads date only; optimistic)
- [x] Events **W** (`tenant.calendar.write`): create / edit / delete in a sheet — all-day / timed, date + time pickers, colour picker, location, note
- [x] Home dashboard "Bugün ve yaklaşanlar" card (events, todos, quote expiries, lead follow-ups for 7 days)
- [x] Live resource `tenant.calendar` (`tenant.calendar.read`): calendar screen and the Bugün card refresh on calendar event changes / moves
- [x] Mock calendar API with seeded events and every module layer (`scripts/smoke/calendar.smoke.ts`)

## 13c. Reviews — `tenant.reviews.*` (plan `reviews.enabled`, `reviews.monthly`)
- [x] `/reviews` (Menu → Müşteriler → Değerlendirmeler, `tenant.reviews.read`; badge = follow-ups needed): period chips, KPI tiles (average, response rate, satisfaction score, Google redirects, follow-up tile that filters the list), score distribution, search, filter chips (all / follow-up / low / high / awaiting / answered), infinite list with stars, comment, plate, channel and follow-up state
- [x] "Ele alındı" **O** (`tenant.reviews.write` + owner) from the list card or the detail footer, with an optional note (sheet)
- [x] `/reviews/[id]`: score, comment, rating / status / follow-up badges, follow-up note and who handled it, delivery timeline (planned send incl. quiet-hours deferral, sent / opened / expiry, channel, skip reason, error), customer and job links, test link share
- [x] `/reviews/settings` (read for staff, edits **O**): enable, channel (auto / WhatsApp / SMS with availability badges and a link to messaging), delay presets, quiet hours, Google review URL (https check + how-to), threshold, frequency cap, default language, consent text, excluded customers (read-only, edited on the web), template preview, monthly usage, test send to own phone
- [x] Customer 360: "Değerlendirmeler" section; push `review.low_score` → `/t/{slug}/reviews/{uuid}` deep link (`deep-links.ts`)
- [x] Plan lock via `ReviewsModuleGate` (`FEATURE_DISABLED`), live resource `tenant.reviews`, mock API (seeded per organization, job delivery schedules a request, cancel / void cancels it) and `scripts/smoke/reviews.smoke.ts`

## 14. Staff — `tenant.staff.*`
- [ ] List (status, role)
- [ ] Create **O** (name, surname, email, password), activate/deactivate **O**, reset password **O**

## 15. Reports — `tenant.reports.*`
- [ ] Filters: date range, granularity, currency, payment method, account, source
- [ ] KPIs, timeseries chart, services/products mix, income/expense categories, payment methods, sources, cari receivables, top customers
- [ ] Export (reports.export) — share file

## 16. Contracts — `tenant.contracts.*`
- [x] Instances list + detail (signers, status, PDF)
- [x] On-site signing with signature pad, OTP verify over WhatsApp or SMS (channel choice when an SMS provider is active)
- [x] Gallery media upload: camera, photo library, Files (`expo-image-picker` / `expo-document-picker`; JPEG/PNG/WebP/GIF/PDF, 12 MB) with caption; delete while open
- [ ] Templates list/detail; clone preset **O**; void **O**

## 17. Settings
- [ ] Letterhead / export settings **O** (`tenant.settings.*`)
  - [x] Business sector (`sector` on `/v1/tenant/settings`, "" clears) on the settings screen; the create-business wizard sends the chosen sector to `POST /v1/auth/organizations`
- [ ] Messaging (WhatsApp session, templates, notification rules, daily summary, vehicle alerts)
  - [x] Kanallar tab: WhatsApp / SMS – Netgsm / SMS – Twilio / e-posta cards with brand icons and status; connect / edit sheet (masked hints, empty keeps stored), activate switch (one active provider), connection test result, test SMS with live segment counter (`/sms/estimate`, debounced), disconnect with confirm; owner-only writes, read-only for others (`scripts/smoke/sms.smoke.ts`)
  - [x] WhatsApp / SMS channel choice on the daily summary and vehicle alerts cards; SMS notification rules unlock when an SMS provider is active
- [x] Usage & limits (`/settings/usage`, read-only): plan name/status, period end, usage meters (warn ≥ 80 %, full at 100 %, unlimited), included modules
- [x] ~~Plans, checkout/order, report payment, invoices, invoice profile~~ — removed for good: no in-app purchases (App Store 3.1.1/3.1.3, Play payments policy); backend e-mails the owner

## 18. I/O
- [ ] Exports list + detail (download/share)
- [x] Imports list + detail **O**, rollback inside the 24 h window
- [x] Import wizard **O** (`/imports/new`, `expo-document-picker`): upload → column mapping (auto-match) → defaults → preview → confirm; sample files via share sheet; resume an unconfirmed job from its detail. Finance accounts/categories only (catalog has no tenant upload route)

## 19. Profile
- [ ] Profile edit (name, surname, locale), change password
- [ ] Preferences: theme, language, notification preferences (`/v1/tenant/notification-preferences`)
- [ ] Sessions (list, revoke, revoke others), 2FA status
- [x] Linked accounts (`/profile/linked-accounts`): list, link Apple / Google with the native sheet, unlink; last sign-in method of a password-less account can't be removed; `OAUTH_ACCOUNT_NOT_LINKED` sends the user here after sign-in (mock; native link route proposed, see port-reports/account.md)
- [x] Preferences: AI data-sharing consent status + withdraw

## 20. Assistant — `tenant.ai.use`
- [x] Conversations list (last message preview, sorted and timed by `last_message_at`), chat, tool activity — SSE streaming (tokens render as they arrive), same reader for mock and live; list → conversation screens (`/assistant`, `/assistant/[id]`, `/assistant/new`), rename / delete by long press
- [x] Confirm cards (edit / confirm / cancel, result + record link) and plan checklists (`actions` / `todos` features) — confirm streams the `action` result and the follow-up over SSE
- [x] First-use AI data disclosure + explicit consent (App Store 5.1.2(i)): provider named from `/ai/status`, what is / isn't sent, stored per user, sending blocked until accepted, withdraw in Preferences

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

## Siri & Shortcuts (App Intents)

- [x] `expo-app-intents` (alpha) + inline modules: app-owned Swift in `app-intents/` (synchronized group in the app target via prebuild), built from source (`expo.autolinking.ios.buildFromSource`)
- [x] 8 App Shortcuts, Turkish + English phrases (`app-intents/AppShortcuts.xcstrings`, titles in `Localizable.xcstrings`; `plugins/with-app-intents-locales.js` adds `tr` to the project regions): günün özeti (answers without opening the app), yeni iş emri (optional plate), plaka ara, müşteriyi aç (customer entity), hazır araçlar, asistana sor, QR ile giriş, bugünkü takvim
- [x] Invocations routed in JS (`src/features/intents/routing.ts`): permission gates as the target screens, newest fresh invocation only (10 min TTL), plate lookups, kept until sign-in
- [x] Catalogs for Siri: today's figures (same rules as the dashboard), ≤ 40 recent customers (name + plates only, opt-out switch); wiped on sign-out and org switch; shortcuts refreshed on org / role change
- [x] Donations after in-app actions (throttled, permission-checked, never free text); deleted on sign-out, org switch and from settings
- [x] Profil → Tercihler → "Siri ve Kısayollar" card (phrases for this member, sharing switch, open Shortcuts, clear suggestions)
- [x] No-op on Android / web / Expo Go (`isAvailable()`); pure parts in `scripts/smoke/intents.smoke.ts`
- [ ] Device QA on TestFlight: Xcode build + `ExtractAppIntentsMetadata`, each phrase in Turkish and English Siri, cold vs. warm invocation, Shortcuts app tiles, customer resolution, sign-out wipe

## Plan limits (no in-app purchases)

- [x] Mobile shows no prices, purchase / upgrade / subscribe CTAs or links to buy; dead billing code (orders, invoices, invoice profile, plans) removed
- [x] Usage screen `src/app/(app)/settings/usage.tsx`, gated by `tenant.billing.read`; menu entry "Kullanım ve limitler"
- [x] Global `LIMIT_REACHED` dialog with role-based copy and translated feature names (`mobile.plan.*`)
- [x] Shared `FEATURE_DISABLED` lock state, neutral owner/staff copy; dashboard insights hidden when reports are off
- [x] Mock scenarios on the diagnostics screen: normal / near limit / at limit / module off / quotes module off / read-only (owner and staff), plus an organization access switch (normal / ended / paused / no membership)
- [x] `module.quotes` lock on quotes + leads list, detail and form screens; dashboard pipeline hidden when off
- [x] `SUBSCRIPTION_READ_ONLY` uses the shared plan dialog (owner: details e-mailed, staff: ask the manager); no toast
- [x] `scripts/smoke/account.smoke.ts` covers linked accounts, access states, quotes lock, read-only, assistant actions and consent
- [x] `scripts/smoke/plan.smoke.ts` covers meters, limit errors, lock errors, copy and role gates
- [ ] Live check against the Go API (LIMIT_REACHED details list, AI `plan_disabled`)
- [ ] Device QA: dialog on iOS/Android, lock states in light/dark, tr/en
