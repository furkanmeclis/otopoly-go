# CRM port report (todos · leads · quotes)

## Routes built

| Web page | Mobile file |
|---|---|
| `todos/page.tsx` | `src/app/(app)/todos.tsx` |
| `leads/page.tsx` | `src/app/(app)/leads/index.tsx` |
| `leads/[uuid]/page.tsx` | `src/app/(app)/leads/[id].tsx` |
| `LeadDialog` (create/edit) | `src/app/(app)/leads/form.tsx` (`?id=` edit, `?customer=` prefill) |
| `quotes/page.tsx` | `src/app/(app)/quotes/index.tsx` |
| `quotes/[uuid]/page.tsx` | `src/app/(app)/quotes/[id].tsx` (`?send=1` opens the send sheet, like web) |
| `quotes/new`, `quotes/[uuid]/edit` | `src/app/(app)/quotes/form.tsx` (`?id=` edit, `?lead=` / `?customer=` prefill) |

Feature code:
- `features/todos`: `queries.ts` (infinite list, single todo, create/patch/delete mutations), `lib/reminders.ts`,
  `components/todo-form-sheet.tsx` (`TodoFormSheet`: title, date, time, assignee, reminders, customer/lead/quote links, notes, delete),
  `reminder-picker.tsx`, `ref-pickers.tsx`, `linked-todos.tsx` (web LinkedTodosCard), `todo-row.tsx` extended.
- `features/leads`: `queries.ts`, `lib/lead-ui.ts`, `components/temperature-toggle.tsx`, `lead-sheets.tsx` (lost reason, todo from lead),
  `crm-ui.tsx` (Chip, ActionMenu sheet, Stepper, Notice). Other CRM screens use these too.
- `features/quotes`: `queries.ts`, `lib/quote-ui.ts` (status tones, BigInt totals preview copied from the web, delivery error text),
  `components/quote-sheets.tsx` (send, convert to job, decision, reminders, copy link via `expo-clipboard`, PDF via `downloadAndShare`).

Parity notes:
- Todos: the tabs match the web exactly (today + overdue, upcoming, no date, assigned to me, done), with count badges from the summary.
  Added on mobile: search (the API supports `q`) and a `?customer=` filter. `?todo=` deep-links open the edit sheet (web reminder links).
  Tapping a row edits it; long-pressing deletes it after a confirm; the circle completes or reopens it.
- Leads: summary strip, status segments (open / won / lost / all), search, quick chips (overdue / today / hot / mine),
  a temperature toggle on each row, and a status picker on each row. Detail: stepper, temperature, a "More" menu (edit, mark lost or reopen, delete),
  call, advance, create quote, create todo, the follow-up date plus today / tomorrow / 1 week chips, quotes, linked todos, and a timeline with notes.
- Quotes: summary tiles, eight status tabs, search, and rows with status stripe, viewed eye, converted badge and validity date.
  Detail: stepper and terminal banner, decision banner, lines, totals, notes and terms, deliveries with retry, reminders, history and linked todos.
  The "More" menu has PDF, copy/open link, edit, resend, convert, accept, reject, cancel and duplicate.
  Editor: customer picker with quick create, vehicle mode (none / saved / free with plate, label and catalog model), catalog search (a repeat pick adds 1 to the quantity),
  custom lines, line discount (tap to cycle none / % / ₺), VAT, quote discount, "prices include VAT", validity chips (7 / 15 / 30 days / no expiry),
  a live total preview, and "save draft" or "save & send".

## Role gates (mirrors web)
- Screens: `todos.read`, `leads.read`, `quotes.read`. Forms: `leads.write`, `quotes.write`.
- Todo create, edit, complete and delete: `todos.write`. Lead edit, delete, status and temperature: `leads.write`. Lead "create todo": `leads.write` + `todos.write`.
  Lead "create quote": `quotes.write`.
- Quote write actions: `quotes.write`. Convert: `quotes.write` + `jobs.write` + `can_convert`. None of these are owner-only on the web.

## Mock changes (`src/api/mock/handlers/crm.ts`)
- `GET /leads?status=open` now returns new, contacted and quoted leads, as in the backend SQL. With `sort=follow_up_date`, leads without a date come last.
- `GET /quotes?status=open` now returns draft, sent and viewed quotes plus accepted quotes not yet converted, as in the backend SQL.
- `PATCH /todos/:uuid` now handles `lead_uuid`, `quote_uuid` and `job_uuid`. Setting reminders without a due date is rejected, and clearing the date clears the reminders.
- Todos now compute `next_reminder_at`. A todo with no time counts as due at 09:00 Istanbul time.
- `POST /quotes/:uuid/send` for a customer with no phone now marks the quote sent with a failed delivery (`customer_no_phone…`), as the backend does. Before, it returned a 409.
- A free-text vehicle `label` on a quote is now kept.
- The summary endpoints the menu badges use are unchanged.

## Left out / decisions
- The web's `FeatureLocked` (403 FEATURE_DISABLED) state is not special-cased; the generic `ErrorState` shows instead.
- The web lists fetch 100 items at once; mobile pages 20 at a time with infinite scroll, so the web's "shown / total" line is not needed.
- In the leads list, choosing "lost" from a row's status picker opens the lost-reason sheet. The web sends it straight away, and the backend then rejects it for the missing reason.
- The public quote page (`/q/…`) is not part of this area.

## Known issues
- `node scripts/check-i18n.mjs` reports `mobile.settings.ai_renamed` as missing. It is used in `src/features/ai/queries.ts`, which belongs to another area.
- `tsc`, eslint on the CRM files, and `npm run test:mock` all pass.
