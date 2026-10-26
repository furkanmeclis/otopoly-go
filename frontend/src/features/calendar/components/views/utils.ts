import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  max as maxDate,
  min as minDate,
  startOfDay,
} from "date-fns";
import { enUS, tr, type Locale } from "date-fns/locale";

import type { CalendarViewItem } from "./types";

export const HOUR_HEIGHT = 48;
export const SLOT_MINUTES = 30;
export const SLOT_HEIGHT = (HOUR_HEIGHT * SLOT_MINUTES) / 60;
export const RESIZE_MINUTES = 15;
export const RESIZE_HEIGHT = (HOUR_HEIGHT * RESIZE_MINUTES) / 60;
export const MAX_DAY_ITEMS = 3;

export function dateFnsLocale(locale: string): Locale {
  return locale === "tr" ? tr : enUS;
}

export function dayKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

export function formatTime(date: Date): string {
  return format(date, "HH:mm");
}

/** Exclusive end that is always after start (zero-length items get a minimal span). */
function effectiveEnd(item: CalendarViewItem): Date {
  if (item.end.getTime() > item.start.getTime()) return item.end;
  return item.allDay
    ? addDays(startOfDay(item.start), 1)
    : addMinutes(item.start, 1);
}

/** Whether the item covers any part of the given calendar day. */
export function coversDay(item: CalendarViewItem, day: Date): boolean {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  return item.start < to && effectiveEnd(item) > from;
}

export function compareItems(a: CalendarViewItem, b: CalendarViewItem) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const diff = a.start.getTime() - b.start.getTime();
  if (diff !== 0) return diff;
  return b.end.getTime() - a.end.getTime() || a.title.localeCompare(b.title);
}

/** Items covering the day, all-day first, then by start time. */
export function itemsForDay(
  items: CalendarViewItem[],
  day: Date,
): CalendarViewItem[] {
  return items.filter((item) => coversDay(item, day)).sort(compareItems);
}

export type TimedSegment = {
  item: CalendarViewItem;
  start: Date;
  end: Date;
  /** Item starts on this day (not clipped at the top). */
  isStart: boolean;
  /** Item ends on this day (not clipped at the bottom) → resizable here. */
  isEnd: boolean;
  column: number;
  columns: number;
};

const MIN_LAYOUT_MINUTES = 20;

/**
 * Clips timed items to the given day and assigns side-by-side columns
 * per cluster of overlapping segments.
 */
export function layoutTimedSegments(
  items: CalendarViewItem[],
  day: Date,
): TimedSegment[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const segments: TimedSegment[] = [];
  for (const item of items) {
    if (item.allDay || !coversDay(item, day)) continue;
    const end = effectiveEnd(item);
    segments.push({
      item,
      start: maxDate([item.start, dayStart]),
      end: minDate([end, dayEnd]),
      isStart: item.start >= dayStart,
      isEnd: end <= dayEnd,
      column: 0,
      columns: 1,
    });
  }
  segments.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      b.end.getTime() - a.end.getTime(),
  );

  const layoutEnd = (s: TimedSegment) =>
    Math.max(s.end.getTime(), s.start.getTime() + MIN_LAYOUT_MINUTES * 60_000);

  let cluster: TimedSegment[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const s of cluster) s.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const seg of segments) {
    const start = seg.start.getTime();
    if (start >= clusterEnd) flush();
    let col = columnEnds.findIndex((end) => end <= start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[col] = layoutEnd(seg);
    seg.column = col;
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, layoutEnd(seg));
  }
  flush();
  return segments;
}

export function minutesIntoDay(date: Date, day: Date): number {
  return differenceInMinutes(date, startOfDay(day));
}

export function itemAriaLabel(
  item: CalendarViewItem,
  allDayLabel: string,
  dfLocale: Locale,
): string {
  const parts = [item.title];
  if (item.subtitle) parts.push(item.subtitle);
  if (item.allDay) {
    const lastDay = addDays(effectiveEnd(item), -1);
    parts.push(
      isSameDay(item.start, lastDay)
        ? `${format(item.start, "PP", { locale: dfLocale })}, ${allDayLabel}`
        : `${format(item.start, "PP", { locale: dfLocale })} – ${format(lastDay, "PP", { locale: dfLocale })}, ${allDayLabel}`,
    );
  } else {
    parts.push(
      `${format(item.start, "PP", { locale: dfLocale })} ${formatTime(item.start)} – ${formatTime(item.end)}`,
    );
  }
  return parts.join(", ");
}

/** Snap a pixel delta to `step` px and return the number of steps. */
export function snapSteps(delta: number, step: number): number {
  return Math.round(delta / step);
}
