/**
 * Pure helpers for calendar feed items: local days, placement, labels and grouping. Kept free of React /
 * React Native so the smoke tests can run them.
 *
 * The grid works on wall-clock Dates of the business time zone (Europe/Istanbul, the zone the API
 * buckets days in): timed items are converted with `businessWallClock`, moves go back through
 * `wallClockToISO`. On a phone set to Türkiye time both are the identity.
 */
import type { CalendarFeedItem, CalendarMoveInput } from '../types';
import { businessDateTimeISO, businessWallClock } from '@/lib/business-date';
import { kindKey } from './kinds';

type T = (key: string, params?: Record<string, string | number>) => string;
type Money = (value: string | number | null | undefined, currency?: string) => string;

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day (YYYY-MM-DD). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** YYYY-MM-DD → local midnight. */
export function localDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const shiftDay = (day: string, n: number) => dayKey(addDays(localDay(day), n));
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Monday-first 6×7 month grid around `month` (any day of it). */
export function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function itemStart(item: CalendarFeedItem): Date {
  return item.all_day && item.start_date ? localDay(item.start_date) : businessWallClock(item.starts_at);
}

/** "Now" on the business wall clock. */
export const businessNow = (now: number | Date = Date.now()) => businessWallClock(now);

/** Exclusive end. */
export function itemEnd(item: CalendarFeedItem): Date {
  return item.all_day && item.end_date ? addDays(localDay(item.end_date), 1) : businessWallClock(item.ends_at);
}

/** Every local day the item covers (multi-day events show on each day). */
export function itemDays(item: CalendarFeedItem): string[] {
  const start = startOfDay(itemStart(item));
  const end = itemEnd(item);
  const days: string[] = [];
  for (let d = start; d < end && days.length < 62; d = addDays(d, 1)) days.push(dayKey(d));
  return days.length ? days : [dayKey(start)];
}

/** All-day items first, then by start time, then title. */
export function compareItems(a: CalendarFeedItem, b: CalendarFeedItem) {
  return Number(b.all_day) - Number(a.all_day) || itemStart(a).getTime() - itemStart(b).getTime() || a.title.localeCompare(b.title);
}

/** Items per local day. */
export function groupByDay(items: CalendarFeedItem[]) {
  const map = new Map<string, CalendarFeedItem[]>();
  for (const item of items) for (const day of itemDays(item)) map.set(day, [...(map.get(day) ?? []), item]);
  for (const list of map.values()) list.sort(compareItems);
  return map;
}

export const isMuted = (item: CalendarFeedItem) => item.status === 'done' || item.status === 'cancelled';

/** Title + subtitle per kind (web `describe`). */
export function describe(item: CalendarFeedItem, t: T, money: Money) {
  const amount = item.amount ? money(item.amount, item.currency ?? 'TRY') : null;
  const kind = t(kindKey(item.kind));
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;
  switch (item.kind) {
    case 'finance_income':
    case 'finance_expense':
      return { title: `${kind} · ${amount ?? ''}`, subtitle: t('calendar.finance_count', { count: item.count ?? 0 }) };
    case 'quote_expiry':
    case 'job_delivered':
      return { title: `${kind} · ${item.title}`, subtitle: join(item.subtitle, amount) };
    case 'lead_follow_up':
      return { title: `${kind} · ${item.title}`, subtitle: item.subtitle || null };
    case 'sale':
    case 'purchase':
      return { title: `${kind} · ${amount ?? ''}`, subtitle: item.title || null };
    default:
      return { title: item.title, subtitle: join(item.subtitle, amount) };
  }
}

/**
 * Move body that places `item` on `day` (YYYY-MM-DD). `time` (HH:mm) makes it timed; null makes it all-day.
 * Events keep their length; leads only have a date.
 */
export function moveBody(item: CalendarFeedItem, day: string, time: string | null): CalendarMoveInput {
  const layer = item.layer as CalendarMoveInput['layer'];
  const refUuid = item.ref_uuid ?? '';
  if (layer === 'leads' || !time) {
    const span = item.layer === 'events' && item.all_day ? Math.max(0, itemDays(item).length - 1) : 0;
    return { layer, ref_uuid: refUuid, all_day: true, start_date: day, end_date: shiftDay(day, span) };
  }
  const startsAt = businessDateTimeISO(day, time);
  const duration = item.all_day ? 60 * 60000 : Math.max(15 * 60000, itemEnd(item).getTime() - itemStart(item).getTime());
  return { layer, ref_uuid: refUuid, all_day: false, starts_at: startsAt, ends_at: new Date(new Date(startsAt).getTime() + duration).toISOString() };
}

/** Optimistic placement of a moved item in a cached feed (web `placeInFeeds`). */
export function placeItem(item: CalendarFeedItem, body: CalendarMoveInput): CalendarFeedItem {
  if (body.all_day && body.start_date) return { ...item, all_day: true, start_date: body.start_date, end_date: body.end_date ?? body.start_date };
  if (!body.all_day && body.starts_at) {
    const { start_date: _s, end_date: _e, ...rest } = item;
    return { ...rest, all_day: false, starts_at: body.starts_at, ends_at: body.ends_at ?? item.ends_at };
  }
  return item;
}

/**
 * Lays out the timed items of one day in side-by-side lanes (overlapping items split the width).
 * Returns minutes from midnight and the lane index / count for each item.
 */
export function layoutDay(items: CalendarFeedItem[], day: string) {
  const dayStart = localDay(day).getTime();
  const dayEnd = addDays(localDay(day), 1).getTime();
  const rows = items
    .filter((i) => !i.all_day)
    .map((item) => {
      const s = Math.max(itemStart(item).getTime(), dayStart);
      const e = Math.min(Math.max(itemEnd(item).getTime(), s + 20 * 60000), dayEnd);
      return { item, top: (s - dayStart) / 60000, bottom: (e - dayStart) / 60000, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  // Group transitively overlapping rows into clusters; each cluster shares the same lane count.
  let cluster: typeof rows = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes: number[] = [];
    for (const r of cluster) {
      let lane = lanes.findIndex((end) => end <= r.top);
      if (lane === -1) lane = lanes.push(0) - 1;
      lanes[lane] = r.bottom;
      r.lane = lane;
    }
    for (const r of cluster) r.lanes = lanes.length;
    cluster = [];
  };
  for (const r of rows) {
    if (cluster.length && r.top >= clusterEnd) close();
    cluster.push(r);
    clusterEnd = Math.max(clusterEnd, r.bottom);
  }
  if (cluster.length) close();
  return rows;
}
