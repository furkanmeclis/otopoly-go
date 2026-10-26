"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  setHours,
  startOfDay,
  type Locale,
} from "date-fns";

import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils/index";

import { CalendarDnd, dropId, type DropData } from "./calendar-dnd";
import { ChipBody, focusRing, ItemChip } from "./item-chip";
import {
  COLOR_CLASSES,
  monthGrid,
  type CalendarViewItem,
  type CalendarViewsProps,
} from "./types";
import { useNow } from "./use-now";
import { dateFnsLocale, dayKey, itemsForDay, MAX_DAY_ITEMS } from "./utils";

type MonthViewProps = Pick<
  CalendarViewsProps,
  | "items"
  | "date"
  | "onDateChange"
  | "onViewChange"
  | "onItemClick"
  | "onSlotClick"
  | "onItemMove"
> & { weekStartsOn: 0 | 1 };

const MAX_DOTS = 4;

export function MonthView({
  items,
  date,
  weekStartsOn,
  onDateChange,
  onViewChange,
  onItemClick,
  onSlotClick,
  onItemMove,
}: MonthViewProps) {
  const { t, locale } = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const now = useNow();
  const { start, weeks } = monthGrid(date, weekStartsOn);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));

  const openDay = (day: Date) => {
    onDateChange(day);
    onViewChange("day");
  };

  return (
    <CalendarDnd
      onItemMove={onItemMove}
      renderOverlay={(item) => (
        <ChipBody item={item} className="ring-border shadow-md ring-1" />
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-7 border-b">
          {days.slice(0, 7).map((day) => (
            <div
              key={dayKey(day)}
              className="text-muted-foreground px-2 py-1.5 text-center text-xs font-medium capitalize sm:text-left"
            >
              <span className="sm:hidden">
                {format(day, "EEEEE", { locale: dfLocale })}
              </span>
              <span className="hidden sm:inline">
                {format(day, "EEE", { locale: dfLocale })}
              </span>
            </div>
          ))}
        </div>
        <div
          className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
          style={{
            gridTemplateRows: `repeat(${weeks}, minmax(min-content, 1fr))`,
          }}
        >
          {days.map((day) => (
            <MonthCell
              key={dayKey(day)}
              day={day}
              items={itemsForDay(items, day)}
              outside={!isSameMonth(day, date)}
              today={now !== null && isSameDay(day, now)}
              dfLocale={dfLocale}
              allDayLabel={t("calendar.all_day")}
              moreLabel={(count) => t("calendar.more", { count })}
              onOpenDay={openDay}
              onItemClick={onItemClick}
              onSlotClick={onSlotClick}
            />
          ))}
        </div>
      </div>
    </CalendarDnd>
  );
}

function MonthCell({
  day,
  items,
  outside,
  today,
  dfLocale,
  allDayLabel,
  moreLabel,
  onOpenDay,
  onItemClick,
  onSlotClick,
}: {
  day: Date;
  items: CalendarViewItem[];
  outside: boolean;
  today: boolean;
  dfLocale: Locale;
  allDayLabel: string;
  moreLabel: (count: number) => string;
  onOpenDay: (day: Date) => void;
  onItemClick: (item: CalendarViewItem) => void;
  onSlotClick: (start: Date, allDay: boolean) => void;
}) {
  const data: DropData = { day, mode: "month" };
  const { setNodeRef, isOver } = useDroppable({
    id: dropId("month", day),
    data,
  });
  const visible = items.slice(0, MAX_DAY_ITEMS);
  const hidden = items.length - visible.length;
  const dayLabel = format(day, "PPPP", { locale: dfLocale });

  return (
    <div
      ref={setNodeRef}
      onClick={() => onSlotClick(setHours(startOfDay(day), 9), true)}
      className={cn(
        "flex min-h-16 min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-r border-b p-1 transition-colors sm:min-h-28 [&:nth-child(7n)]:border-r-0",
        outside && "bg-muted/40",
        isOver ? "bg-accent" : "hover:bg-muted/30",
      )}
    >
      <div className="flex justify-center sm:justify-start">
        <button
          type="button"
          aria-label={dayLabel}
          aria-current={today ? "date" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onOpenDay(day);
          }}
          className={cn(
            "hover:bg-accent inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
            focusRing,
            outside && "text-muted-foreground",
            today && "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {format(day, "d")}
        </button>
      </div>

      <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {visible.map((item) => (
          <ItemChip
            key={item.id}
            item={item}
            day={day}
            mode="month"
            allDayLabel={allDayLabel}
            dfLocale={dfLocale}
            onItemClick={onItemClick}
          />
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDay(day);
            }}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground rounded-sm px-1.5 text-left text-xs leading-5 font-medium",
              focusRing,
            )}
          >
            {moreLabel(hidden)}
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <button
          type="button"
          aria-label={`${dayLabel}: ${items.map((item) => item.title).join(", ")}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenDay(day);
          }}
          className={cn(
            "flex flex-wrap items-center justify-center gap-0.5 rounded-sm py-0.5 sm:hidden",
            focusRing,
          )}
        >
          {items.slice(0, MAX_DOTS).map((item) => (
            <span
              key={item.id}
              className={cn(
                "size-1.5 rounded-full",
                COLOR_CLASSES[item.color].dot,
                item.muted && "opacity-50",
              )}
            />
          ))}
          {items.length > MAX_DOTS ? (
            <span className="text-muted-foreground text-[10px] leading-none">
              +{items.length - MAX_DOTS}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
