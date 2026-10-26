"use client";

import { addDays, format, isSameDay } from "date-fns";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { createElement, useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { COLOR_CLASSES } from "@/features/calendar/components/views/types";
import { useNow } from "@/features/calendar/components/views/use-now";
import { useCalendarFeed } from "@/features/calendar/hooks/use-calendar";
import { describe, itemStart } from "@/features/calendar/lib/feed-items";
import { itemColor, LAYER_DEFS } from "@/features/calendar/lib/layers";
import type {
  CalendarFeedItem,
  CalendarLayer,
} from "@/features/calendar/types";
import { cn } from "@/lib/utils";
import { dateFnsLocale } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { businessToday, shiftDay } from "@/lib/utils/business-date";

/** Forward-looking layers (jobs / sales are records of what happened). */
const UPCOMING_LAYERS: CalendarLayer[] = ["events", "todos", "quotes", "leads"];
const DAYS = 7;
const MAX_ROWS = 8;

/** Dashboard card: today and the next days from the calendar. */
export function CalendarUpcomingWidget({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const { hasPermission } = usePermission();
  const canRead = hasPermission(permissions.calendar.read);
  const today = useMemo(() => new Date(), []);
  const from = businessToday(today);
  const to = shiftDay(from, DAYS);
  const feed = useCalendarFeed(from, to, UPCOMING_LAYERS, canRead);

  const nowDate = useNow();
  const groups = useMemo(() => {
    const now = nowDate?.getTime() ?? 0;
    const items = (feed.data?.items ?? [])
      // Hide finished todos and timed items already in the past.
      .filter((i) => i.status !== "done")
      .filter((i) => i.all_day || new Date(i.ends_at).getTime() >= now)
      .sort(
        (a, b) =>
          itemStart(a).getTime() - itemStart(b).getTime() ||
          Number(b.all_day) - Number(a.all_day),
      )
      .slice(0, MAX_ROWS);
    const out: { day: Date; items: CalendarFeedItem[] }[] = [];
    for (const item of items) {
      const start = itemStart(item);
      const day = start < today ? today : start;
      const last = out[out.length - 1];
      if (last && isSameDay(last.day, day)) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [feed.data, today, nowDate]);

  if (!canRead) return null;

  const dayLabel = (day: Date) => {
    if (isSameDay(day, today)) return t("calendar.today");
    if (isSameDay(day, addDays(today, 1))) return t("calendar.tomorrow");
    return format(day, "EEEE, d MMMM", { locale: dfLocale });
  };

  return (
    <section
      className="bg-card flex flex-col rounded-2xl border"
      data-widget="calendar"
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="text-primary size-4" />
          {t("calendar.widget.title")}
        </h2>
        <Link
          href={routes.tenant.calendar.root(slug)}
          className="text-primary text-xs font-medium hover:underline"
        >
          {t("calendar.widget.open")}
        </Link>
      </div>
      {feed.isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : feed.isError ? (
        <p className="text-muted-foreground px-6 py-6 text-center text-sm">
          {t("calendar.error.title")}
        </p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground px-6 py-6 text-center text-sm">
          {t("calendar.widget.empty")}
        </p>
      ) : (
        <div className="divide-y">
          {groups.map((group) => (
            <div key={group.day.toISOString()} className="py-1">
              <p className="text-muted-foreground px-4 pt-1.5 pb-0.5 text-[11px] font-medium tracking-wide uppercase">
                {dayLabel(group.day)}
              </p>
              <ul>
                {group.items.map((item) => {
                  const def = LAYER_DEFS[item.layer];
                  const { title, subtitle } = describe(item, t, locale);
                  const href =
                    item.layer === "events" && item.ref_uuid
                      ? routes.tenant.calendar.event(slug, item.ref_uuid)
                      : (def.href(slug, item) ??
                        routes.tenant.calendar.root(slug));
                  return (
                    <li key={item.id}>
                      <Link
                        href={href}
                        className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2 transition-colors"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-lg",
                            COLOR_CLASSES[itemColor(item)].chip,
                          )}
                        >
                          {createElement(def.icon, { className: "size-3.5" })}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {title}
                          </span>
                          {subtitle ? (
                            <span className="text-muted-foreground block truncate text-xs">
                              {subtitle}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {item.all_day
                            ? t("calendar.all_day")
                            : format(itemStart(item), "HH:mm")}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
