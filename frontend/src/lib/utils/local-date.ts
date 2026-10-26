import {
  businessDayOf,
  businessToday,
  daysBetween,
  shiftDay,
} from "@/lib/utils/business-date";

/** Today's business day (yyyy-MM-dd, Europe/Istanbul); UTC would show yesterday after midnight in TR. */
export function localToday(): string {
  return businessToday();
}

export function shiftDate(isoDate: string, days: number): string {
  return shiftDay(isoDate, days);
}

/** Business day (yyyy-MM-dd, Europe/Istanbul) of an ISO timestamp. */
export function localDateOf(iso: string): string {
  return businessDayOf(iso);
}

/** Whole calendar days from `from` to `to` (both yyyy-MM-dd). */
export function calendarDaysBetween(from: string, to: string): number {
  return daysBetween(from, to);
}
