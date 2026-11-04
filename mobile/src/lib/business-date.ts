/**
 * Business calendar of Otopoly: every "day" (default dates, "today", day
 * filters, day buckets) is a calendar day in Europe/Istanbul, whatever zone
 * the phone is set to — the API dates records the same way.
 *
 * Türkiye has been UTC+3 all year since 2016 (no DST), so the helpers use the
 * fixed offset instead of Intl time zones (Hermes support for `timeZone` /
 * `formatToParts` differs per platform). Kept free of React / React Native so
 * the smoke tests can run them.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Istanbul';
/** Europe/Istanbul offset from UTC (minutes). */
export const BUSINESS_UTC_OFFSET_MINUTES = 180;

const OFFSET_MS = BUSINESS_UTC_OFFSET_MINUTES * 60_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

const toMs = (value: Date | string | number) => (value instanceof Date ? value.getTime() : new Date(value).getTime());

/** True for a bare calendar day (yyyy-MM-dd). */
export const isDayString = (value: unknown): value is string => typeof value === 'string' && DAY_RE.test(value);

/** Business day (yyyy-MM-dd, Europe/Istanbul) of an instant; a bare day stays as it is. */
export function businessDayOf(value: Date | string | number): string {
  if (isDayString(value)) return value;
  return new Date(toMs(value) + OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's business day (yyyy-MM-dd, Europe/Istanbul). */
export const businessToday = (now: Date | number = Date.now()) => businessDayOf(now);

/** First day of the current business month (yyyy-MM-01). */
export const businessMonthStart = (now: Date | number = Date.now()) => `${businessToday(now).slice(0, 7)}-01`;

/** Calendar arithmetic on a yyyy-MM-dd day (no time zone involved). */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both yyyy-MM-dd). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * A Date whose local fields show the Europe/Istanbul wall clock of the instant (calendar grids and
 * formatters read local fields). A display value: convert back with `wallClockToISO`.
 */
export function businessWallClock(value: Date | string | number): Date {
  const u = new Date(toMs(value) + OFFSET_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
}

/** The instant (ISO) of a wall-clock Date built by `businessWallClock` / local-field arithmetic. */
export function wallClockToISO(wall: Date): string {
  const utc = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds());
  return new Date(utc - OFFSET_MS).toISOString();
}

/** Midnight (Europe/Istanbul) of a business day, as an ISO instant. */
export function businessDayStartISO(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS).toISOString();
}

/** An Istanbul wall-clock time (yyyy-MM-dd + HH:mm) as an ISO instant. */
export function businessDateTimeISO(day: string, time: string): string {
  const [h, min] = time.split(':').map(Number);
  return new Date(new Date(businessDayStartISO(day)).getTime() + ((h || 0) * 60 + (min || 0)) * 60_000).toISOString();
}

/** HH:mm on the Istanbul wall clock of an instant. */
export function businessTimeOf(value: Date | string | number): string {
  const u = new Date(toMs(value) + OFFSET_MS);
  return `${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}`;
}
