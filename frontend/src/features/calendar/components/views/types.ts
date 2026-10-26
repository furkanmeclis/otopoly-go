import {
  addDays,
  addWeeks,
  differenceInCalendarWeeks,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { LucideIcon } from "lucide-react";

export type CalendarView = "month" | "week" | "day" | "agenda";

export const CALENDAR_COLORS = [
  "blue",
  "emerald",
  "amber",
  "rose",
  "violet",
  "sky",
  "orange",
  "teal",
  "pink",
  "slate",
] as const;

export type CalendarColor = (typeof CALENDAR_COLORS)[number];

/** Static i18n keys of the colour names (check-i18n can verify them). */
export const COLOR_LABEL_KEYS: Record<CalendarColor, string> = {
  blue: "calendar.colors.blue",
  emerald: "calendar.colors.emerald",
  amber: "calendar.colors.amber",
  rose: "calendar.colors.rose",
  violet: "calendar.colors.violet",
  sky: "calendar.colors.sky",
  orange: "calendar.colors.orange",
  teal: "calendar.colors.teal",
  pink: "calendar.colors.pink",
  slate: "calendar.colors.slate",
};

export type CalendarViewItem = {
  /** Unique id. */
  id: string;
  title: string;
  /** e.g. customer / amount */
  subtitle?: string | null;
  start: Date;
  /** For allDay items: exclusive end (start of the day after the last day). */
  end: Date;
  allDay: boolean;
  color: CalendarColor;
  /** Only editable items are draggable. */
  editable: boolean;
  /** Editable items can also be resized (bottom edge) unless this is false. */
  resizable?: boolean;
  /** e.g. done todo / cancelled → faded + line-through title. */
  muted?: boolean;
  /** Small leading icon. */
  icon?: LucideIcon;
};

export type CalendarViewsProps = {
  items: CalendarViewItem[];
  view: CalendarView;
  /** Anchor date of the visible range. */
  date: Date;
  /** Default 1 (Monday). */
  weekStartsOn?: 0 | 1;
  /** Default 7 — initial scroll position in week/day. */
  dayStartHour?: number;
  loading?: boolean;
  onDateChange: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
  onItemClick: (item: CalendarViewItem) => void;
  /** Empty slot click → create. */
  onSlotClick: (start: Date, allDay: boolean) => void;
  /** Drag (and bottom-edge resize in week/day) of editable items. */
  onItemMove?: (item: CalendarViewItem, start: Date, end: Date) => void;
};

export const AGENDA_DAYS = 30;

/** First day and number of weeks shown by the month grid (min 5 weeks). */
export function monthGrid(
  date: Date,
  weekStartsOn: 0 | 1 = 1,
): { start: Date; weeks: number } {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn });
  const last = startOfWeek(endOfMonth(date), { weekStartsOn });
  const weeks = Math.max(
    5,
    differenceInCalendarWeeks(last, start, { weekStartsOn }) + 1,
  );
  return { start, weeks };
}

/** Visible range of a view: `from` inclusive start-of-day, `to` exclusive. */
export function visibleRange(
  view: CalendarView,
  date: Date,
  weekStartsOn: 0 | 1 = 1,
): { from: Date; to: Date } {
  switch (view) {
    case "month": {
      const { start, weeks } = monthGrid(date, weekStartsOn);
      return { from: start, to: addWeeks(start, weeks) };
    }
    case "week": {
      const from = startOfWeek(date, { weekStartsOn });
      return { from, to: addDays(from, 7) };
    }
    case "day": {
      const from = startOfDay(date);
      return { from, to: addDays(from, 1) };
    }
    case "agenda": {
      const from = startOfDay(date);
      return { from, to: addDays(from, AGENDA_DAYS) };
    }
  }
}

export const COLOR_CLASSES: Record<
  CalendarColor,
  { dot: string; chip: string; block: string; border: string }
> = {
  blue: {
    dot: "bg-blue-500",
    chip: "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:text-blue-300",
    block:
      "bg-blue-500/15 border-l-blue-500 text-blue-900 hover:bg-blue-500/25 dark:bg-blue-500/25 dark:text-blue-100",
    border: "border-blue-500",
  },
  emerald: {
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300",
    block:
      "bg-emerald-500/15 border-l-emerald-500 text-emerald-900 hover:bg-emerald-500/25 dark:bg-emerald-500/25 dark:text-emerald-100",
    border: "border-emerald-500",
  },
  amber: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300",
    block:
      "bg-amber-500/15 border-l-amber-500 text-amber-900 hover:bg-amber-500/25 dark:bg-amber-500/25 dark:text-amber-100",
    border: "border-amber-500",
  },
  rose: {
    dot: "bg-rose-500",
    chip: "bg-rose-500/15 text-rose-700 hover:bg-rose-500/25 dark:text-rose-300",
    block:
      "bg-rose-500/15 border-l-rose-500 text-rose-900 hover:bg-rose-500/25 dark:bg-rose-500/25 dark:text-rose-100",
    border: "border-rose-500",
  },
  violet: {
    dot: "bg-violet-500",
    chip: "bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-300",
    block:
      "bg-violet-500/15 border-l-violet-500 text-violet-900 hover:bg-violet-500/25 dark:bg-violet-500/25 dark:text-violet-100",
    border: "border-violet-500",
  },
  sky: {
    dot: "bg-sky-500",
    chip: "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:text-sky-300",
    block:
      "bg-sky-500/15 border-l-sky-500 text-sky-900 hover:bg-sky-500/25 dark:bg-sky-500/25 dark:text-sky-100",
    border: "border-sky-500",
  },
  orange: {
    dot: "bg-orange-500",
    chip: "bg-orange-500/15 text-orange-700 hover:bg-orange-500/25 dark:text-orange-300",
    block:
      "bg-orange-500/15 border-l-orange-500 text-orange-900 hover:bg-orange-500/25 dark:bg-orange-500/25 dark:text-orange-100",
    border: "border-orange-500",
  },
  teal: {
    dot: "bg-teal-500",
    chip: "bg-teal-500/15 text-teal-700 hover:bg-teal-500/25 dark:text-teal-300",
    block:
      "bg-teal-500/15 border-l-teal-500 text-teal-900 hover:bg-teal-500/25 dark:bg-teal-500/25 dark:text-teal-100",
    border: "border-teal-500",
  },
  pink: {
    dot: "bg-pink-500",
    chip: "bg-pink-500/15 text-pink-700 hover:bg-pink-500/25 dark:text-pink-300",
    block:
      "bg-pink-500/15 border-l-pink-500 text-pink-900 hover:bg-pink-500/25 dark:bg-pink-500/25 dark:text-pink-100",
    border: "border-pink-500",
  },
  slate: {
    dot: "bg-slate-500",
    chip: "bg-slate-500/15 text-slate-700 hover:bg-slate-500/25 dark:text-slate-300",
    block:
      "bg-slate-500/15 border-l-slate-500 text-slate-900 hover:bg-slate-500/25 dark:bg-slate-500/25 dark:text-slate-100",
    border: "border-slate-500",
  },
};
