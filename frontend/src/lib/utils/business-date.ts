/**
 * Business calendar of Otopoly: every "day" (default dates, "today", day
 * filters, day buckets) is a calendar day in Europe/Istanbul, whatever zone
 * the browser or the Next.js server runs in. `toISOString().slice(0, 10)` is
 * the UTC day and is wrong between 00:00 and 03:00 Türkiye time.
 *
 * Dependency-free on purpose (scripts/test-business-date.mjs runs it in Node).
 */
export const BUSINESS_TIME_ZONE = "Europe/Istanbul";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function wallClockParts(value: Date | string | number): WallClock {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(toDate(value))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** True for a bare calendar day (yyyy-MM-dd). */
export function isDayString(value: unknown): value is string {
  return typeof value === "string" && DAY_RE.test(value);
}

/** Business day (yyyy-MM-dd, Europe/Istanbul) of an instant. */
export function businessDayOf(value: Date | string | number): string {
  if (isDayString(value)) return value;
  const p = wallClockParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Today's business day (yyyy-MM-dd, Europe/Istanbul). */
export function businessToday(now: Date = new Date()): string {
  return businessDayOf(now);
}

/** First day of the current business month (yyyy-MM-01). */
export function businessMonthStart(now: Date = new Date()): string {
  return `${businessToday(now).slice(0, 7)}-01`;
}

/** Calendar arithmetic on a yyyy-MM-dd day (no time zone involved). */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to` (both yyyy-MM-dd). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/**
 * A Date whose local fields show the Europe/Istanbul wall clock of the
 * instant, for formatters that read local fields (date-fns `format`). Do not
 * send it back to the API; it is a display value.
 */
export function businessWallClock(value: Date | string | number): Date {
  const p = wallClockParts(value);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Offset of Europe/Istanbul from UTC at an instant, in minutes. */
function offsetMinutes(at: Date): number {
  const p = wallClockParts(at);
  const asUTC = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUTC - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Midnight (Europe/Istanbul) of a business day, as an ISO instant. */
export function businessDayStartISO(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const instant = new Date(guess.getTime() - offsetMinutes(guess) * 60_000);
  return instant.toISOString();
}

/** An Istanbul wall-clock time (yyyy-MM-dd + HH:mm) as an ISO instant. */
export function businessDateTimeISO(day: string, time: string): string {
  const [h, min] = time.split(":").map(Number);
  const start = new Date(businessDayStartISO(day));
  return new Date(start.getTime() + (h * 60 + min) * 60_000).toISOString();
}
