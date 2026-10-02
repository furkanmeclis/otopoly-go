# Settings area — port report

## Routes built

| Web page (`(tenant)/t/[slug]/…`) | Mobile file | Notes |
|---|---|---|
| `settings/messaging/page.tsx` (MessagingPage) | `src/app/(app)/settings/messaging.tsx` | Tabs "Connection & rules" / "Templates" (Segmented). Cards: WhatsApp session, notification rules, vehicle alerts, daily summary; template catalog + editor sheet. |
| `settings/billing/page.tsx` (SubscriptionPage) | `src/app/(app)/settings/usage.tsx` | Replaced by the read-only **Kullanım ve limitler / Usage & limits** screen: plan name + status, period end, usage meters (warning ≥ 80 %, full at 100 %, unlimited), included modules. No prices, orders, invoices or payment details. |
| `settings/page.tsx` (io SettingsPage, scope=tenant) | `src/app/(app)/settings/letterhead.tsx` | Letterhead preview, company name, tagline, colour, paper size, contact fields, remove logo. |
| `assistant/page.tsx` (AssistantPage) | `src/app/(app)/assistant.tsx` | Chat with suggestions, typing animation, stop, history sheet (search / rename / delete), new chat, quota + disclaimer, unavailable / plan-locked states. Conversation kept in `?c=` like the web. |

Every screen has pull-to-refresh (except the chat), skeletons, `ErrorState` with retry and empty states.

## New code
- `src/features/messaging/`: `queries.ts`, `lib/render.ts` (web template renderer), `lib/qr.ts` (dependency-free QR encoder), `components/` (session card, rules card, templates panel, template editor sheet, daily summary, vehicle alerts, shared parts).
- `src/features/billing/`: `queries.ts` (overview only), `lib.ts` (pure meter/tone/copy helpers), `components/usage-meter.tsx`, `components/limit-reached-host.tsx` (global `LIMIT_REACHED` dialog), `components/feature-locked.tsx` (shared `FEATURE_DISABLED` state).
- `src/features/ai/` (new): `types.ts`, `services/ai.service.ts`, `queries.ts` (status, conversations, `useAssistantChat`), `lib/labels.ts`, `components/chat.tsx`, `components/markdown.tsx`.
- `src/features/export-settings/service.ts` (new): the tenant `/v1/tenant/settings` service and hook. It lives outside `features/io`, which belongs to the documents area.
- `src/locales/mobile/areas/settings.{tr,en}.json`: 7 mobile-only strings.
- `scripts/smoke/settings.smoke.ts`: 45 checks, all passing. Build it with the same esbuild flags as `test:mock`.

## Mock routes (all in files I own)
- `handlers/settings.ts`:
  - Messaging session: GET, connect and DELETE. Connect returns `qr_pending` with a real QR payload and a 60 s expiry. The demo "scans" it automatically after 9 s. The GET response shape is unchanged for the dashboard.
  - Rules: GET, PATCH `/rules/:event/:channel`.
  - Templates: GET `/template-types`, PUT/DELETE `/template-types/:type/:channel/:locale`. Unknown placeholders return a 400 validation error.
  - Simulate: POST `/messaging/simulate`.
  - Daily summary: GET, PUT, `/preview`, `/test`.
  - Vehicle alerts: GET, PUT, `/test`.
  - Letterhead settings: GET, PATCH `/v1/tenant/settings`, plus PUT/DELETE `/logo`.
  - Template bodies and placeholders mirror the backend registry and migration 000052.
- `handlers/billing.ts`: overview only (backend feature keys, meters from the demo DB) plus `enforcePlan()`, which the transport runs before every tenant route to return `409 LIMIT_REACHED` / `403 FEATURE_DISABLED` for the demo plan scenario (`src/api/mock/scenario.ts`, switched on the diagnostics screen).
- `handlers/ai.ts`: status (with quota), conversations CRUD, and POST `/messages`. Answers are fixed, predictable replies computed from the demo DB: deliveries today, this month's income as a chart, top receivables, cash balances, low stock, and a today's-jobs summary as the fallback. Each has tool chips. The mock waits 450 ms before answering.

## Role gates (mirror the backend)
- **Messaging:**
  - The screen needs `messaging.read`.
  - All write actions need owner + `messaging.write`: connect, refresh, disconnect, rule toggles, simulate, template save/reset/test, and the vehicle-alert and daily-summary cards.
  - For everyone else the templates open read-only.
  - The web shows rule switches and simulate to everyone even though the backend refuses them. Mobile hides them.
- **Billing:** `billing.read`.
- **Letterhead:** owner + `settings.read`. The backend requires owner for reading too, so the mobile guard is stricter than the menu gate. Editing needs owner + `settings.write`.
- **Assistant:** `ai.use`.

## Intentionally left out
- **Anything that sells (final product decision):** prices, plans to compare, checkout, orders, invoices, payment details, upgrade / subscribe wording and links to buy. App Store 3.1.1 / 3.1.3 and Google Play payments policy. The backend e-mails the tenant owner instead.
- **Logo upload:** the app has no image or document picker dependency and I could not add one. Mobile shows the logo and lets you remove it. Upload stays on the web.
- **Assistant voice:** push-to-talk and read-aloud are left out (the mock reports `voice: false`). Confirm cards and plan checklists were added in wave 3b (see `account.md`).
- **Colour picker:** the web uses a native colour input. Mobile uses a hex field plus 8 preset colours.

## Known issues
- **Live assistant streaming:** the Go API answers `/messages` with SSE. The mobile service expects JSON, which is what the mock returns. Live mode needs an SSE reader built on `expo/fetch` streaming.
- **Markdown:** the renderer is minimal (paragraphs, headings, lists, bold/italic/code). The web renderer also handles tables and links.
- **Mock state:** messaging, AI and letterhead state is kept in memory per handler module. It resets when the app restarts and is not written to the persisted mock DB, because `db.ts` is shared and I could not edit it.
- **QR encoder:** I checked `qr.ts` against the `toqr` package that ships with `@expo/cli`. The matrices match module-for-module when the same mask is used; only the automatic mask choice differs, and any mask is valid.

## Verification
- `npx tsc --noEmit`: clean.
- `eslint` on my files: clean.
- `node scripts/check-i18n.mjs`: passes.
- `npm run test:mock`: ALL PASSED.
- Settings smoke script: all 45 checks pass.
