# Business time zone (Europe/Istanbul)

Otopoly's business calendar is **Europe/Istanbul** (Türkiye, UTC+3, no DST).
Every *business date* — "which day did this happen", default dates, "today",
day buckets, day-range filters, daily sweeps — is a calendar day in that zone,
whatever zone the server, the container (production: UTC), the browser or the
phone runs in. Timestamps (`timestamptz`) stay instants.

## Rules

| Layer | Use |
|-------|-----|
| Go | `internal/platform/bizclock`: `Location()`, `Now()`, `DateOf(t) pgtype.Date`, `Today()`, `FormatDay(t)`, `ParseDay("YYYY-MM-DD") (start, end)`, `StartOfDay`, `NextDay`, `MonthStart`. Never `pgtype.Date{Time: time.Now()}` (pgx encodes the wall-clock Y/M/D of the time, i.e. the UTC day), never `time.Now().Format("2006-01-02")`, never `time.Local` defaults. Services that date records take an injectable clock (`SetClock`). |
| Postgres | Every app connection runs with `timezone = Europe/Istanbul` (`database.ParsePoolConfig` / `NewPostgresPool`; tests open pools with `database.NewPoolFromDSN`). `timestamptz::date`, `date_trunc(..., timestamptz)`, `CURRENT_DATE` and `date → timestamptz` casts therefore follow Türkiye's calendar. `AT TIME ZONE 'Europe/Istanbul'` expressions keep working unchanged. Write `AT TIME ZONE 'UTC'` when a query really means UTC. |
| Web | `frontend/src/lib/utils/business-date.ts` (`businessToday`, `businessDayOf`, `businessMonthStart`, `shiftDay`, `businessDayStartISO`, `businessWallClock`); `lib/utils/local-date.ts` and the `date` / `datetime` formatters use it. Never `toISOString().slice(0, 10)` for a day. Smoke test: `pnpm test:dates`. |
| Mobile | `src/lib/business-date.ts` (same helpers); `localToday` / day keys use it. |

## Root cause of the "01:38 → previous day" bug

The API container runs in UTC. Job close (`pgtype.Date{Time: time.Now()}`),
product sales and purchases (`pgtype.Date{Time: soldAt}` with a UTC instant)
wrote the UTC day into `finance_transactions.transaction_date` /
`cari_entries.entry_date`; the web and mobile forms defaulted dates with
`new Date().toISOString().slice(0, 10)` (also the UTC day), and several
defaults / filters (finance summary, reports range, purchases filter, jobs and
sales day filters over HTTP) used UTC or the server-local zone. Between 00:00
and 03:00 Türkiye time all of these landed on the previous day.

## Data repair (migration 000097)

`000097_business_day_repair` re-dates only rows whose date the system derived
itself (source-owned entries cannot be edited by people):

| Table | Source | Instant |
|-------|--------|---------|
| `finance_transactions` | `service_job` | `service_job_payments.created_at` |
| `finance_transactions` | `product_sale` | `product_sales.sold_at` |
| `finance_transactions` | `purchase` | `purchases.purchased_at` |
| `cari_entries` | `service_job` | `service_job_payments.created_at` |
| `cari_entries` | `product_sale` | `product_sales.sold_at` |

A row changes only when its date equals the UTC day of the instant and differs
from the Istanbul day. Manual entries, `cari_payment` collections and any date a
person typed are never touched; loyalty entries already used the Istanbul day.
The migration is idempotent; its down step is a no-op.

Read-only preview (run before deploying to see what 000097 will change):

```sql
WITH src AS (
  SELECT 'finance' AS tbl, t.uuid, t.organization_id, t.source_type,
         t.transaction_date AS current_date_value,
         COALESCE(p.created_at, s.sold_at, pu.purchased_at) AS instant
  FROM finance_transactions t
  LEFT JOIN service_job_payments p ON t.source_type = 'service_job' AND p.uuid = t.source_uuid
  LEFT JOIN product_sales s ON t.source_type = 'product_sale' AND s.uuid = t.source_uuid
  LEFT JOIN purchases pu ON t.source_type = 'purchase' AND pu.uuid = t.source_uuid
  WHERE t.source_type IN ('service_job', 'product_sale', 'purchase')
  UNION ALL
  SELECT 'cari', e.uuid, e.organization_id, e.source_type,
         e.entry_date, COALESCE(p.created_at, s.sold_at)
  FROM cari_entries e
  LEFT JOIN service_job_payments p ON e.source_type = 'service_job' AND p.uuid = e.source_uuid
  LEFT JOIN product_sales s ON e.source_type = 'product_sale' AND s.uuid = e.source_uuid
  WHERE e.source_type IN ('service_job', 'product_sale')
)
SELECT tbl, organization_id, source_type, uuid,
       current_date_value AS old_date,
       (instant AT TIME ZONE 'Europe/Istanbul')::date AS new_date,
       instant
FROM src
WHERE instant IS NOT NULL
  AND current_date_value = (instant AT TIME ZONE 'UTC')::date
  AND current_date_value <> (instant AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY organization_id, instant;
```

Manual entries saved between 00:00 and 03:00 with the (wrong) default date
cannot be told apart from a deliberately chosen previous day, so they are
left alone; this query lists candidates for a manual review only:

```sql
SELECT organization_id, uuid, transaction_date, created_at
FROM finance_transactions
WHERE (source_type IS NULL OR source_type IN ('', 'manual'))
  AND transaction_date = (created_at AT TIME ZONE 'UTC')::date
  AND transaction_date <> (created_at AT TIME ZONE 'Europe/Istanbul')::date
ORDER BY organization_id, created_at;
```
