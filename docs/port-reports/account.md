# Account, access and assistant actions (wave 3b): port report

Everything runs on the in-app mock. Web reference: `frontend/src/features/account/components/github-identity-manager.tsx`, `features/organizations/components/tenant-route-guard.tsx`, `features/ai/components/chat/{confirm-card,plan-block}.tsx`.

## Built

| Area | Mobile | Notes |
|---|---|---|
| Linked accounts | `src/app/(app)/profile/linked-accounts.tsx`, profile row "Bağlı hesaplar" | Apple and Google cards: linked date, link with the native sheet (demo identity picker in mock builds), unlink with confirmation. Providers the device can't offer show "can't be linked on this device". |
| Unlink rule | `src/features/account/lib/identities.ts` | An account **without a password** can't remove its last linked provider (button disabled with an explanation; the mock answers `409 LAST_SIGN_IN_METHOD`). The web has no such rule and neither does the backend today; see backend gaps. |
| `OAUTH_ACCOUNT_NOT_LINKED` | `use-sign-in-flow.ts`, `features/account/link-intent.ts`, `LinkIntentHost` | The notice now says "Profil → Bağlı hesaplar". After the user signs in the usual way, the app opens that screen with a hint for the provider. Dismissing the notice drops the hint. |
| Tenant access states | `features/auth/components/tenant-access-{gate,state}.tsx`, `features/auth/lib/access.ts` | Same states as the web `TenantRouteGuard`: no membership → denied, `access_ends_at` passed / `expired` → ended, `suspended` → paused (the web folds it into "expired"). Neutral copy; the owner is told the details were e-mailed, staff to ask their manager. Actions: choose another business, try again, sign out. A tenant call answering `NO_TENANT_MEMBERSHIP`, `ORGANIZATION_ACCESS_EXPIRED` or `FORBIDDEN` (the backend's answer for a suspended org) reloads `/v1/auth/me` (at most every 10 s). Blocked rows in the org picker open the same state in a sheet. |
| `SUBSCRIPTION_READ_ONLY` | `limit-reached-host.tsx`, `lib/mutation.ts` | Uses the shared plan dialog (title "Yeni kayıt açılamıyor", owner / staff copy, "Kullanımı gör"). No toast. The server's own message ("aboneliğinizi yenileyin") is never shown. The assistant maps the code to the usage screen's read-only sentence. |
| `module.quotes` lock | `features/billing/components/module-gate.tsx` | `QuotesModuleGate` wraps the quotes and leads list, detail and form screens and shows the shared `FeatureLockedState`. It probes the cached summary query (the backend checks the feature before the permission). The dashboard pipeline is hidden when the module is off. |
| Assistant confirm cards | `features/ai/components/action-blocks.tsx` | Port of the web `ConfirmCard`: action label, title, amount, status badge, fields, warnings, inline edit (text / money / select / date / time), confirm / cancel, result line with "Kaydı aç" (record link mapped to app routes). |
| Plan checklists | same file | Port of the web `PlanBlock` (`todo_list` blocks, updated in place). |
| AI data consent | `features/ai/consent.ts`, `components/consent.tsx`, Preferences card | Before the first message: which provider receives data (from `/v1/tenant/ai/status` `provider`: `anthropic` → "Anthropic (Claude)", `openai_compatible` → "an OpenAI-compatible AI server"), what is sent (messages and chat history, name, role, business name, the records the assistant reads: customer names, phones, plates, jobs, amounts, balances, stock, todos), what isn't (password, session, other device data), and how to withdraw. Sending is blocked until "Kabul ediyorum". Stored per user on the device (`ai.consent.<userUuid>`), tied to the provider and a disclosure version. Withdraw in Profile → Tercihler. |

Provider check: `backend/internal/modules/ai/provider` supports `anthropic` (default, official SDK) and `openai_compatible` (for example a self-hosted Ollama / vLLM). The disclosure names whichever one the status reports.

## Mock

- `handlers/passwordless.ts`: `GET /v1/auth/identities` (adds `has_password`), `POST /v1/auth/identities/:provider/native`, `DELETE /v1/auth/identities/:provider`.
- `scenario.ts`: plan scenarios `quotes_disabled` and `read_only`. A new access scenario: `normal` / `expired` / `suspended` / `removed`. Both are switched on the diagnostics screen.
- `handlers/auth.ts` and `index.ts`: the access scenario changes `/me` (status, `access_ends_at`, memberships), org-context and every tenant route, with the backend's codes in the backend's order.
- `handlers/billing.ts`: `module.quotes` gates `/v1/tenant/quotes*` and `/v1/tenant/leads*`. Read-only refuses writes except billing and exports (backend `readOnlyAllowed`), and the overview reports `read_only`.
- `handlers/ai.ts`: status reports `actions` / `todos` on and `provider: "anthropic"`. A reminder / todo request ("Yarın lastik siparişini hatırlat") gets a plan, a pending `create_todo` chip and a confirm card. `POST /v1/tenant/ai/actions/:uuid/confirm` creates the todo (edits applied, `via_ai`) and returns `{ block, message }`. `/cancel` returns `{ block }`. Covered errors: `AI_ACTION_RESOLVED`, `AI_ACTION_EXPIRED` (15 min), `AI_ACTION_FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`.

## Backend gaps (proposed contracts)

1. **Native linking while signed in:** `POST /v1/auth/identities/{apple|google}/native {id_token, nonce?, authorization_code?}` (Bearer) → `LinkedIdentity`.
   - Errors: `409 IDENTITY_ALREADY_LINKED` (the identity belongs to another user), `409 CONFLICT` (another identity of this provider is already linked), `401 INVALID_ID_TOKEN`, `403 OAUTH_PROVIDER_DISABLED`.
   - The web links through NextAuth, so this endpoint doesn't exist yet.
2. **`has_password` on `GET /v1/auth/identities`**, and a `409 LAST_SIGN_IN_METHOD` guard on `DELETE /v1/auth/identities/{provider}`. Without them the client enables unlink and the server decides.
3. **AI consent server-side (optional):** consent is device-local today. A per-user record would survive reinstalls and other devices.
4. **Live assistant:** `/messages` and `/actions/{uuid}/confirm` stream SSE. The mobile services expect JSON (as before for `/messages`).

## Open items

- A privacy policy link on the consent screen (the app has no privacy URL configured yet; it belongs to the store audit).
- Native link flow not tried on a device: needs a dev build plus the backend endpoint above.
- Live check that the backend's suspended answer is still a generic `FORBIDDEN` (the gate relies on the `/me` reload, not on the code).
- Quotes and leads entries in Menu stay visible when the module is off. They open the lock state, same as reports.

## Verification

`npx tsc --noEmit`, `npx expo lint`, `node scripts/check-i18n.mjs` and `npm run test:smoke` all pass. That covers 10 suites, including the new `account.smoke.ts`.
