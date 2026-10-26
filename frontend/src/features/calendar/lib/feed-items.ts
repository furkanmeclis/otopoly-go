import { addDays, parseISO } from "date-fns";

import type { CalendarViewItem } from "@/features/calendar/components/views/types";
import { itemColor, kindKey, LAYER_DEFS } from "@/features/calendar/lib/layers";
import type { CalendarFeedItem } from "@/features/calendar/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import type { AppLocale } from "@/config/i18n";

type T = (key: string, params?: Record<string, string | number>) => string;

/** YYYY-MM-DD → local midnight (all-day items follow the wall calendar). */
export function localDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function itemAmount(item: CalendarFeedItem, locale: AppLocale) {
  return item.amount
    ? formatFinanceAmount(item.amount, item.currency ?? "TRY", locale)
    : null;
}

/** Title + subtitle shown on the calendar for each kind of feed item. */
export function describe(item: CalendarFeedItem, t: T, locale: AppLocale) {
  const amount = itemAmount(item, locale);
  const kind = t(kindKey(item.kind));
  switch (item.kind) {
    case "finance_income":
    case "finance_expense":
      return {
        title: `${kind} · ${amount ?? ""}`,
        subtitle: t("calendar.finance_count", { count: item.count ?? 0 }),
      };
    case "quote_expiry":
      return {
        title: `${kind} · ${item.title}`,
        subtitle: [item.subtitle, amount].filter(Boolean).join(" · ") || null,
      };
    case "lead_follow_up":
      return {
        title: `${kind} · ${item.title}`,
        subtitle: item.subtitle || null,
      };
    case "job_delivered":
      return {
        title: `${kind} · ${item.title}`,
        subtitle: [item.subtitle, amount].filter(Boolean).join(" · ") || null,
      };
    case "sale":
    case "purchase":
      return {
        title: `${kind} · ${amount ?? ""}`,
        subtitle: item.title || null,
      };
    default:
      return {
        title: item.title,
        subtitle: [item.subtitle, amount].filter(Boolean).join(" · ") || null,
      };
  }
}

export function itemStart(item: CalendarFeedItem): Date {
  return item.all_day && item.start_date
    ? localDay(item.start_date)
    : parseISO(item.starts_at);
}

export function itemEnd(item: CalendarFeedItem): Date {
  return item.all_day && item.end_date
    ? addDays(localDay(item.end_date), 1)
    : parseISO(item.ends_at);
}

export function toViewItem(
  item: CalendarFeedItem,
  t: T,
  locale: AppLocale,
): CalendarViewItem {
  const { title, subtitle } = describe(item, t, locale);
  return {
    id: item.id,
    title,
    subtitle,
    start: itemStart(item),
    end: itemEnd(item),
    allDay: item.all_day,
    color: itemColor(item),
    editable: item.movable,
    // Only own events have a duration; todos / follow-ups are points in time.
    resizable: item.layer === "events",
    muted: item.status === "done" || item.status === "cancelled",
    icon: LAYER_DEFS[item.layer].icon,
  };
}
