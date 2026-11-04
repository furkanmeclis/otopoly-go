# Commerce area port report (sales · suppliers · purchases · cari)

## Routes built

| Web page / component | Mobile file |
|---|---|
| `sales/page.tsx` (`SalesPage`) | `src/app/(app)/sales/index.tsx` |
| `sales/[uuid]` (`SaleDetailPage`) | `src/app/(app)/sales/[id].tsx` |
| `QuickSaleDialog` (`sales.quick.*`) | `src/app/(app)/sales/new.tsx` (the `/sales/new` link on the dashboard and operations) |
| `suppliers/page.tsx` (`SuppliersPage`) | `src/app/(app)/suppliers/index.tsx` |
| `suppliers/[uuid]` (`SupplierDetailPage`) | `src/app/(app)/suppliers/[id].tsx` |
| `SupplierDialog` (create/edit) | `src/app/(app)/suppliers/form.tsx` (`?id=` for edit) |
| `purchases/page.tsx` (`PurchasesPage`) | `src/app/(app)/purchases/index.tsx` |
| `purchases/[uuid]` (`PurchaseDetailPage`) | `src/app/(app)/purchases/[id].tsx` |
| `CreatePurchaseDialog` | `src/app/(app)/purchases/new.tsx` |
| `cari/page.tsx` (`CariPage`) | `src/app/(app)/cari/index.tsx` |
| `cari/[uuid]` (`CariDetailPage`) + Charge/Payment/Adjustment dialogs | `src/app/(app)/cari/[id].tsx` + `src/features/cari/components/cari-sheets.tsx` |

Supporting code:
- `src/features/sales/components/commerce-parts.tsx`: the day switcher and stat strip (from the web `DaySummaryBar`), the posted/voided status badge, `ProductPicker` (search sheet that hides products already added; shows price and stock), `DraftLines` (qty and price editors, a warning when qty is above stock, line totals), `OptionalCustomerPicker` (clearable, no inline create, like the web quick-sale combobox), and the default-account helper.
- `src/features/sales/queries.ts`: `useProductSearch`.
- `src/features/suppliers/queries.ts`: `useSupplierSearch`.
- `src/features/purchases/queries.ts`: `usePurchasesDay` (the day's posted purchases, for the summary).
- Mobile strings: `src/locales/mobile/areas/commerce.{tr,en}.json` (stock hints, filters and sort labels, date range labels).

What each screen has, matching the web: search, status tabs, day picker with prev/next buttons, day summary (sales from `/sales/summary`; purchases totalled from the day's posted rows, as the web does), infinite scroll, pull-to-refresh, skeletons, error with retry, and empty states with a create action.

Cari list:
- Three KPIs.
- Balance chips: all / has balance / zero balance.
- Filter sheet: active/passive status, and sort by name or balance in either direction (the web's sortable columns).

Cari detail:
- Balance card with the receivable hint, and tax id/office for company customers.
- Link to the customer.
- Ledger with type chips, plus a filter sheet for status, date range and newest/oldest sort.
- Void on each posted entry.

## Role gates (same as the web `use-tenant-*-access` hooks)

- **Sales:**
  - read: `sales.read`
  - quick sale: `sales.write` (staff can create sales)
  - void: owner and `sales.write`
- **Suppliers:**
  - read: `suppliers.read`
  - create, edit, delete: owner and `suppliers.write`
- **Purchases:**
  - read: `purchases.read`
  - create and void: owner and `purchases.write`
- **Cari:**
  - read: `cari.read`
  - charge, payment, adjustment and void entry: owner and `cari.write`

Every screen is wrapped in `RequirePermission`. The form and new screens use the write gate (with the owner flag where the web requires owner). Customer and supplier links only show for users with `customers.read` or `suppliers.read`.

## Mock routes

All commerce routes already existed in `src/api/mock/handlers/commerce.ts`. Two fixes to match the backend:
- `GET /v1/tenant/cari?has_balance=false` now returns accounts with zero balance (backend `cari.sql`).
- `POST /v1/tenant/cari/entries/:uuid/void` on an entry that is already void now returns 409 CONFLICT (backend `VoidEntry`).

## Left out on purpose

- **Sales "return" and "payment" actions:** the brief mentioned them, but the web sale detail only has **void**, so only void is ported.
- **Export / `ResourceIOToolbar`:** there is no shared mobile export component yet, and exports belong to the io area. The `*.meta` capabilities are not used.
- **`reference_no` on cari entries:** the web dialogs don't ask for it either.
- **Toast "Open" action after a quick sale:** instead, the app goes straight to the new sale's detail screen (`router.replace`). The purchase flow does the same, which matches the web.

## Decisions

- **Default finance account (quick sale, purchase, cari payment):** the account marked default, otherwise the first one. This is the web rule, not the per-method rule used by the jobs close sheet.
- **Stock:** shown in the product picker (plus a "Tükendi" badge) and on each line, with a warning when qty is above stock. The server still decides (409 INSUFFICIENT_STOCK, shown as a toast), and nothing is blocked on the phone, same as the web.
- **Void buttons:** use the outline variant with a danger-coloured icon, to avoid raw colours.

## Verification

- `npx eslint` on all commerce files: clean.
- `node scripts/check-i18n.mjs`: no missing commerce keys. The remaining failures are `mobile.finance.*` keys from the finance area.
- `npx tsc --noEmit`: the only error is in `src/api/mock/handlers/ai.ts` (missing `@/features/ai/types`), which belongs to the ai area.
- `npm run test:mock`: ALL PASSED.

## Known issues

- The purchases day summary counts at most 100 posted purchases per day, the same limit as the web.
- The cari entry sheets unmount when they close, so there is no slide-out animation.
