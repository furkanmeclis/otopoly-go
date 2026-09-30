# Port report — catalog / staff / profile (area `catalog`)

## Routes built

| Web page | Mobile file |
|---|---|
| `catalog/page.tsx` (redirects to products) | `src/app/(app)/catalog/index.tsx` — hub: catalog summary KPIs (products, low / out of stock, services, stock cost and sale value) + links |
| `catalog/products` | `src/app/(app)/catalog/products/index.tsx` — summary tiles, search (name/SKU/barcode/category), stock-status chips (in/low/out/untracked, same `stock_status`/`track_stock` mapping as web), filter sheet (category, unit, active, sort), infinite scroll, pull-to-refresh, empty/error/skeleton. `?category=` prefilter |
| `catalog/products/[uuid]` | `products/[id].tsx` — status + stock badges, identity, pricing, stock, created and updated dates, description; owner: adjust stock (sheet), edit, delete (confirm) |
| product dialog | `products/form.tsx` (`?id=` edit) — every web field and default (unit piece, VAT 20, track stock, qty and min alert, active, description) |
| stock adjustment dialog | `features/catalog/components/stock-adjust-sheet.tsx` — current stock / in-out / amount / new stock preview / reason / note |
| `catalog/services` | `services/index.tsx` — summary tiles, search, active chips, filter sheet (category, sort) |
| `catalog/services/[uuid]` | `services/[id].tsx` — info, pricing + VAT, colour tag, **recipe card** (`service-recipe-card.tsx`: product search, qty edit, remove, save; cost/price/margin) |
| service dialog | `services/form.tsx` — the fields plus the colour picker (`service-color-picker.tsx`, auto + 12 palette keys, live preview) |
| `catalog/categories` | `categories/index.tsx` — All(count)/Product/Service tabs, search, active chips, create sheet (default kind follows the tab) |
| `catalog/categories/[uuid]` | `categories/[id].tsx` — info, first 20 products/services in the category (+ "see all" link to the list filtered by `?category=`), edit sheet, delete |
| category dialog | `features/catalog/components/category-form-sheet.tsx` (parent limited to same kind, excluding itself) |
| `staff/page.tsx` | `src/app/(app)/staff/index.tsx` — list (name, e-mail, status, role, created), plan seat meter (`staff.count`, when `tenant.billing.read`), owner: create sheet, activate/deactivate (confirm before deactivating), reset password sheet |
| `profile/page.tsx` | `src/app/(app)/profile/index.tsx` — facts (name, e-mail + verify request, status, locale, roles, UUID), name/surname edit, security links, 2FA status, active sessions (revoke one / revoke others), permission list |
| `profile/password` (web redirects to profile) | `profile/password.tsx` — current/new/confirm with the backend password policy; signs out after success like the web |
| `profile/preferences` (web redirects to profile) | `profile/preferences.tsx` — language (synced with `PATCH /v1/auth/profile {locale}`), user notification switches, per-organization notification types (phone + channels, WhatsApp/SMS need a phone) |

New non-route code: `features/catalog/{queries.ts, lib/units.ts, components/*}`, `features/staff/components/staff-sheets.tsx`,
`features/account/{queries.ts, components/session-list.tsx, services/notification-preferences.service.ts}`, `authService.requestEmailVerify`.

## Mock routes
- `account.ts` (new): `GET/PUT /v1/notification-preferences`, `GET/PUT /v1/tenant/notification-preferences` (backend `UserPreferenceTypes` + `DefaultPrefs`, phone regex, "phone required for WhatsApp/SMS" error), `POST /v1/auth/email/verify-request`, exported `assertPasswordPolicy` (backend `ValidatePassword`). The extra rows are stored lazily on the persisted DB object (`_notificationPrefs`, `_notificationMember`).
- `catalog.ts`: 409 CONFLICT for a duplicate product name/SKU/barcode and a duplicate category name in the same kind. Product PATCH now accepts `stock_quantity` (the backend and web do) and validates before changing anything. Category PATCH accepts `kind` and rejects making a category its own parent. The response shapes are the same, so jobs are not affected.
- `staff.ts`: create and reset-password enforce the full password policy.
- `auth.ts` (profile/password/sessions only): a blank name or surname returns 400. Password change enforces the policy and revokes the user's refresh sessions.
- Smoke: `scripts/smoke/catalog.smoke.ts` (17 checks, all pass; the run command is in its header).

## Role gates
- Catalog read `tenant.catalog.read`. Every write (create/edit/delete/adjust stock/recipe/categories) = `ownerOnly(tenant.catalog.write)` (`CATALOG_WRITE`), same as web `useTenantCatalogAccess`. The forms are wrapped in `RequirePermission`.
- Staff read `tenant.staff.read`. Writes = `ownerOnly(tenant.staff.write)`. There are no actions on the owner row, because the backend returns 409.
- Profile/password/preferences: any signed-in user (the backend has no extra permission).

## Intentionally left out
- **Stock movement ledger**: the web has only a TODO and the backend has no endpoint, so only stock adjustment is ported.
- **Staff role editing**: the web and backend only support activate/deactivate and password reset.
- **Bulk actions, import/export toolbars** on the catalog lists: these belong to the bulk-engine and io areas.
- **Passkeys, OAuth identities, TOTP setup/disable**: these are WebAuthn/OAuth browser flows. The rows show "available from web" and the 2FA on/off status. **Web push** switch is shown but disabled with a mobile hint.
- **Web staff form** validates only length. Mobile applies the backend policy (upper, lower, digit) so users get the error before submitting.

## Known issues / notes
- The permission list is sorted alphabetically. The web uses the `ALL_PERMISSIONS` catalog order, which isn't available on mobile.
- The staff meter reads `[...qk.billing, 'overview']`. If the billing area uses a different key, it's one extra request, nothing breaks.
- `passwordPolicyError` lives in `features/staff/components/staff-sheets.tsx` and is reused by `profile/password.tsx`.
- Verification: `tsc` clean, eslint clean on my files, `npm run test:mock` passes. `check-i18n` reports only other areas' keys (`mobile.crm.*`, `mobile.settings.ai_renamed`).
