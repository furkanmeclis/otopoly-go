# Finance area — port report

## Routes built (web → mobile)

| Web page (`(tenant)/t/[slug]/…`) | Mobile file |
| --- | --- |
| `finance/accounts/page.tsx` | `src/app/(app)/finance/accounts/index.tsx` |
| `finance/accounts/[uuid]/page.tsx` | `src/app/(app)/finance/accounts/[id].tsx` |
| `finance/transactions/page.tsx` | `src/app/(app)/finance/transactions/index.tsx` |
| `finance/transactions/[uuid]/page.tsx` | `src/app/(app)/finance/transactions/[id].tsx` |
| `finance/transactions/income/new`, `expense/new` | `src/app/(app)/finance/transactions/new.tsx` (`?type=income\|expense`, optional `?account=`) |
| `finance/transfers/new/page.tsx` | `src/app/(app)/finance/transfer.tsx` (optional `?from=`) |
| `finance/categories/page.tsx` | `src/app/(app)/finance/categories/index.tsx` |
| `finance/categories/[uuid]/page.tsx` | `src/app/(app)/finance/categories/[id].tsx` |
| `reports/page.tsx` | `src/app/(app)/reports.tsx` |

Every link used by `(tabs)/finance.tsx`, `(tabs)/menu.tsx` and `(tabs)/index.tsx` resolves: `/finance/accounts`, `/finance/accounts/:id`,
`/finance/transactions`, `/finance/transactions/:id`, `/finance/transactions/new?type=`, `/finance/transfer`, `/finance/categories`, `/reports`.

### What each screen contains
- **Accounts list**: search on name, bank and IBAN; active/inactive filter; sort by name, balance (up or down) or currency; infinite scroll; default and inactive badges; negative balances shown in red. Owners get a create sheet with name, type, currency (3-letter ISO), opening balance, bank name and IBAN for bank accounts, and a default switch.
- **Account detail**: balance, badges (type, default, active, negative), KPIs (income, expense, posted, voided), account info, transfer flow (in, out, void count). Writers also get:
  - quick income, expense and transfer buttons, with this account pre-filled;
  - edit (name, bank, IBAN, notes, default, active);
  - set default;
  - deactivate or activate, with a confirm;
  - delete for non-default accounts, with a confirm.
  The ledger is paginated, has type and status filters, and uses `TransactionRow perspective={account}` so transfer signs are correct.
- **Transactions list**: search (description and reference); type chips; filter sheet with status, account, category, date range, currency and sort (newest, oldest, amount up or down, type). Active filters show as removable chips with "clear all". Infinite scroll. Owners get "add income" and "add expense" buttons.
- **Transaction detail**: the full web report — type icon, status badge, document id, amount (struck through when voided) and status hint. Account, counter-account and category are links. Also shows currency, payment method, reference number, description, the source document card (lines, total, "open job/sale/purchase/account" link) or source type, and the created, updated and voided times. **Void** uses a destructive confirm with the web copy and invalidates `MONEY_KEYS`. Web **Print** is replaced by a native **Share** of a text report.
- **New income/expense**: an income/expense switch; account (defaults to the `?account` param, then the default account, then the first one); category (required for expenses; only active categories are listed); amount, date, payment method (cash, card, transfer, other), description, reference number. Validation messages use the web keys, server field errors are shown inline, and there are empty states for "no accounts" and "no categories".
- **Transfer**: from and to accounts with their balances and a swap button; amount, date, description, reference number. It checks that the accounts differ and share a currency, and warns when the amount is more than the source balance.
- **Categories**: kind segment (all, income, expense), search, sort (sort order or name), sections for income and expense with the web empty texts, inactive badge, create sheet. **Category detail**: KPIs (total, posted, voided), info (kind, sort order), filterable ledger, and for owners edit (name, sort order, active), deactivate or activate, and delete (with a confirm).
- **Reports**: every web section is here.
  - Filters: presets (today, 7d, 30d, month) plus a filter sheet with date range, currency (all, TRY, USD, EUR), payment method (all, cash, card, cari), source (manual, service job, product sale, purchase, cari payment), account and granularity; Apply and Reset.
  - All 14 KPIs.
  - Charts: cash flow (income and expense bars plus a net sparkline), payments by method, services (top 8), products (top 8), expenses by category, and finance by source (RankBars with a percentage share).
  - Tables: services, products (with quantity), expenses, open cari receivables, and top customers (tap opens the customer).
  - States: `FEATURE_DISABLED` shows a locked state, errors show `ErrorState` with the API message, and loading shows a skeleton grid.

## Role gates (same as the web `useTenantFinanceAccess` and the backend `RequireOrgRole("owner")`)
- Reading any screen requires `tenant.finance.read` (`RequirePermission`); reports require `tenant.reports.read`.
- Every write requires `can({ perm: tenant.finance.write, owner: true })`: create, edit, delete and deactivate accounts; create, edit and delete categories; income, expense and transfer; void. The write screens (`new`, `transfer`) are guarded with the same gate, and the actions are hidden for everyone else.

## Services and hooks
- `finance.service.ts`: added `patchCategory` and `deleteCategory` (backend routes that already exist), and a `currency` param on `listTransactions`.
- New: `src/features/finance/{lib.ts,queries.ts}` and components `account-sheet`, `category-sheet`, `ledger-list`, `source-card`; `src/features/reports/components/{report-filters,report-parts}.tsx`.

## Mock routes (`src/api/mock/handlers/finance.ts`)
- Added `PATCH` and `DELETE /v1/tenant/finance/categories/:uuid`, matching the backend (name uniqueness per kind → 409; cannot be its own parent; transactions keep the category name).
- Account create now matches the backend: the currency is upper-cased and must be 3 letters (400), and names must be unique among active accounts (409). Setting a default now clears the default on every account in the org, not just accounts of the same type (backend `ClearFinanceAccountDefault`).
- Transfers now return `CURRENCY_MISMATCH` (400) when the two accounts use different currencies, and 404 for unknown accounts.
- The transactions list now takes a `currency` filter.
- `reports.ts`: no change needed.
- Smoke check: `scripts/smoke/finance.smoke.ts`. It passes; run it with the same esbuild command as `test:mock`, pointed at this file.

## Intentionally left out or adapted
- **Import/export toolbar** (`ResourceIOToolbar`) on accounts, transactions, categories and reports: the io/exports area is owned by another agent, and there is no mobile io service yet.
- **Voiding from a list row** (web row menu): on mobile you void from the transaction detail screen, one tap after the row.
- **Print** is replaced by the native share sheet.
- **Additions the web marks as TODO but the backend supports**: account edit, set default, deactivate; category edit, deactivate, delete; payment method and reference number on entries; account pre-fill from account detail.
- **Account delete**: the backend soft-deletes, but the mock still refuses with 409 when the account has transactions. Removing it would leave dangling references in the shared ops. The UI shows the error toast and offers **Deactivate** instead.
- **Voiding a transaction created from a job, sale or purchase**: the mock refuses with 409 ("void the source document"); the backend allows it. I kept the mock rule so the demo data stays consistent, and the UI toasts the error.
- **Category totals** use TRY, same as the web (its own TODO).

## Verification
- `npx tsc --noEmit`: clean.
- `eslint` on all my files: clean.
- `check-i18n`: no missing finance or reports keys. The failures that remain are other areas' keys (`mobile.catalog.*`, `mobile.documents.*`).
- `npm run test:mock`: all passed.
- Finance smoke: all passed.

## Suggested shared changes (not made)
- Add `errors.codes.CURRENCY_MISMATCH` to the shared catalog. The transfer screen already blocks mismatched currencies on the client, so this only matters for the error text.
