"use client";

import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { CalendarX2 } from "lucide-react";

import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils/index";

import { focusRing } from "./item-chip";
import { ItemIcon } from "./item-icon";
import { AGENDA_DAYS, COLOR_CLASSES, type CalendarViewsProps } from "./types";
import { useNow } from "./use-now";
import {
  dateFnsLocale,
  dayKey,
  formatTime,
  itemAriaLabel,
  itemsForDay,
} from "./utils";

type AgendaViewProps = Pick<
  CalendarViewsProps,
  "items" | "date" | "onDateChange" | "onViewChange" | "onItemClick"
>;

export function AgendaView({
  items,
  date,
  onDateChange,
  onViewChange,
  onItemClick,
}: AgendaViewProps) {
  const { t, locale } = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const now = useNow();
  const allDayLabel = t("calendar.all_day");
  const headerFormat = locale === "tr" ? "EEEE, d MMMM" : "EEEE, MMMM d";

  const first = startOfDay(date);
  const groups = Array.from({ length: AGENDA_DAYS }, (_, i) => {
    const day = addDays(first, i);
    return { day, items: itemsForDay(items, day) };
  }).filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-sm">
        <CalendarX2 aria-hidden className="size-8 opacity-50" />
        <p>{t("calendar.empty")}</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {groups.map(({ day, items: dayItems }) => {
        const today = now !== null && isSameDay(day, now);
        return (
          <section
            key={dayKey(day)}
            aria-label={format(day, "PPPP", { locale: dfLocale })}
          >
            <h3 className="bg-muted/80 supports-backdrop-filter:bg-muted/60 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5 text-sm font-semibold backdrop-blur sm:px-4">
              <button
                type="button"
                onClick={() => {
                  onDateChange(day);
                  onViewChange("day");
                }}
                className={cn(
                  "rounded-sm capitalize hover:underline",
                  focusRing,
                )}
              >
                {format(day, headerFormat, { locale: dfLocale })}
              </button>
              {today ? (
                <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[10px] leading-none font-medium uppercase">
                  {t("calendar.today")}
                </span>
              ) : null}
            </h3>
            <ul className="divide-y">
              {dayItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={itemAriaLabel(item, allDayLabel, dfLocale)}
                    onClick={() => onItemClick(item)}
                    className={cn(
                      "hover:bg-muted/50 flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors sm:px-4",
                      focusRing,
                      "focus-visible:ring-offset-0 focus-visible:ring-inset",
                      item.muted && "opacity-60",
                    )}
                  >
                    <span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums sm:w-28">
                      {item.allDay
                        ? allDayLabel
                        : `${formatTime(item.start)} – ${formatTime(item.end)}`}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        COLOR_CLASSES[item.color].dot,
                      )}
                    />
                    <ItemIcon
                      icon={item.icon}
                      className="text-muted-foreground size-4"
                    />
                    <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                      <span
                        className={cn(
                          "truncate font-medium",
                          item.muted && "line-through",
                        )}
                      >
                        {item.title}
                      </span>
                      {item.subtitle ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
