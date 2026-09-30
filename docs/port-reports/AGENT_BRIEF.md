# Screen-port agent brief (shared by all area agents)

You are porting tenant (business-user) screens of the Otopoly web app to this Expo app, **losslessly**:
every field, filter, sort, empty/loading/error state, action, confirmation, toast and role gate the web page has.
Several agents work **in parallel in the same working tree** — stay strictly inside the files you own.

## Sources (read-only)
- Web page to port: `/Users/furkanmeclis/Documents/Projects/otopoly-go/frontend/src/app/(tenant)/t/[slug]/<route>/page.tsx`
  and the components/hooks it imports (`frontend/src/features/**`, `frontend/src/components/**`).
- Backend rules when the web is unclear: `/Users/furkanmeclis/Documents/Projects/otopoly-go/backend` (handlers, SQL, OpenAPI `docs/openapi.yaml`).
- **Never modify anything under `/Users/furkanmeclis/Documents/Projects/otopoly-go`.**

## Mobile patterns to copy (read these first)
- `AGENTS.md`, `docs/PORT_CHECKLIST.md`
- Screens: `src/app/(app)/customers/[id].tsx`, `src/app/(app)/customers/form.tsx`, `src/app/(app)/jobs/[id].tsx`,
  `src/app/(app)/jobs/new.tsx`, `src/app/(app)/(tabs)/finance.tsx`, `src/app/(app)/(tabs)/customers.tsx`
- UI kit (import from `@/components/ui`): Screen, Header, Section, Group, ListRow, InfoRow, Card, Button, IconButton,
  Badge, Txt, Row, Avatar, PlateBadge, EmptyState, ErrorState, ForbiddenState, Skeleton, ListSkeleton, TextField,
  MoneyField, SearchBar, FilterChips, Segmented, SwitchRow, Sheet, SelectField, DateField, Amount, KpiTile, BarChart,
  Sparkline, RankBars, useConfirm. Feedback: `useToast` (`@/components/feedback/toast`).
- Data: services in `src/features/<module>/services/*.ts` (already ported from web). Shared hooks + `qk` keys +
  exported `useInfiniteList` in `src/features/queries.ts` (**read-only for you**). Put new hooks in
  `src/features/<module>/queries.ts` (create it). Mutations: `useApiMutation` from `@/lib/mutation`
  (invalidate with `qk.*` / `MONEY_KEYS`, `toastValidation`, `fieldErrors` for 400 VALIDATION_ERROR).
- Roles: `P` / `Gate` in `src/features/auth/permissions.ts`, `useAuth().can(...)`, `isOwner`,
  `<RequirePermission gate=...>` from `src/features/auth/guard.tsx`. Mirror the web gates exactly
  (owner-only voids/deletes etc.). Hide actions the user can't perform; guard every screen.
- Theme: only `useTheme()` tokens — no raw colours. Must look right in light **and** dark.
- i18n: `const { t: tr, fmt } = useLocale()`. Reuse the web keys (`finance.*`, `sales.*`, … are all in `src/locales/tr|en`).
  Mobile-only strings go in **your area file** `src/locales/mobile/areas/<area>.tr.json` + `.en.json`
  (flat keys prefixed with your area, e.g. `"finance.transfer_hint"` → `tr('mobile.finance.transfer_hint')`).
  Do not reuse a key that already exists in `src/locales/mobile/tr.json`. Both languages, always.
- Logging: `createLogger('screen.<name>')` for notable events/errors. Never `console.log`.
- Money/dates: `fmt.money`, `fmt.date`, `toNumber`, `Amount`; dates as `YYYY-MM-DD` strings like the web.

## Routes
Files go in `src/app/(app)/<route>`. Use exactly the paths the menu already links to (see `src/app/(app)/(tabs)/menu.tsx`
and `(tabs)/finance.tsx`); detail pages `[id].tsx`; forms as `form.tsx` (with `?id=` for edit) or `new.tsx`,
bottom sheets for small forms. Every screen: pull-to-refresh, skeleton while loading, `ErrorState` with retry,
`EmptyState`, infinite scroll for lists (`useInfiniteList`), search/filter chips matching the web filters.

## Mock API (demo mode — the app runs fully on mocks)
- Routes are registered in `src/api/mock/handlers/*.ts` with `route(method, path, handler)` from `../core`
  (`paginate`, `search`, `sortBy`, `requirePerm`, `requireOwner`, `uuid`, `now`). Read `core.ts`, `db.ts`, `ops.ts`, `seed.ts`.
- Only edit the handler files you own. Keep response shapes identical to the backend OpenAPI / web types,
  errors as the backend does (400 VALIDATION_ERROR with `details`, 403, 404, 409 CONFLICT).
- Need extra seeded data? Keep it inside your handler file (deterministic, lazily created) — do **not** edit
  `db.ts` / `seed.ts` / `core.ts` / `ops.ts` (shared). You may call their exported functions.
- Add checks for your new routes in a new file `scripts/smoke/<area>.smoke.ts` only if cheap; don't edit `mock-smoke.ts`.

## Files you must NOT edit
`src/features/queries.ts`, `src/components/**`, `src/app/_layout.tsx`, `src/app/(app)/_layout.tsx`, `src/app/(app)/(tabs)/**`,
`src/locales/index.ts`, `src/locales/mobile/tr.json|en.json`, other areas' files, `package.json`, `package-lock.json`,
`app.json`, `ios/`, `plugins/`, `src/api/mock/{core,db,ops,seed,index}.ts`, `src/api/mock/handlers/index.ts`.
If you truly need a shared change, don't make it — describe it in your report.

## Hard rules
- No git commands that write (no commit/stash/checkout/reset). No `npm install`, no Metro, no Xcode/EAS builds.
- React Compiler lint rules apply: no setState synchronously in effects, no mutating module variables during render.
- TypeScript strict, no `any` unless unavoidable, no stray `export {}` hacks for unused imports — remove them.

## Verify before you finish (fix only errors in your own files)
```
npx tsc --noEmit
npx eslint <your files>
node scripts/check-i18n.mjs
npm run test:mock
```
Other agents are editing concurrently, so a failure in a file you don't own is not yours — note it and move on.

## Report
Write `docs/port-reports/<area>.md`: routes built (web page → mobile file), mock routes added, role gates,
anything intentionally left out and why, known issues. Your final message: the same summary in ≤15 lines.
