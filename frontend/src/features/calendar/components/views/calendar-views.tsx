"use client";

import { addDays, startOfDay, startOfWeek } from "date-fns";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/index";

import { AgendaView } from "./agenda-view";
import { MonthView } from "./month-view";
import { TimeGridView } from "./time-grid-view";
import type { CalendarViewsProps } from "./types";

export function CalendarViews(props: CalendarViewsProps) {
  const {
    items,
    view,
    date,
    weekStartsOn = 1,
    dayStartHour = 7,
    loading = false,
    onDateChange,
    onViewChange,
    onItemClick,
    onSlotClick,
    onItemMove,
  } = props;

  let body: ReactNode;
  switch (view) {
    case "month":
      body = (
        <MonthView
          items={items}
          date={date}
          weekStartsOn={weekStartsOn}
          onDateChange={onDateChange}
          onViewChange={onViewChange}
          onItemClick={onItemClick}
          onSlotClick={onSlotClick}
          onItemMove={onItemMove}
        />
      );
      break;
    case "week":
    case "day": {
      const first =
        view === "week"
          ? startOfWeek(date, { weekStartsOn })
          : startOfDay(date);
      const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) =>
        addDays(first, i),
      );
      body = (
        <TimeGridView
          key={view}
          items={items}
          days={days}
          dayStartHour={dayStartHour}
          onDateChange={onDateChange}
          onViewChange={onViewChange}
          onItemClick={onItemClick}
          onSlotClick={onSlotClick}
          onItemMove={onItemMove}
        />
      );
      break;
    }
    case "agenda":
      body = (
        <AgendaView
          items={items}
          date={date}
          onDateChange={onDateChange}
          onViewChange={onViewChange}
          onItemClick={onItemClick}
        />
      );
      break;
  }

  return (
    <div
      aria-busy={loading || undefined}
      className="bg-background relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
    >
      <div
        className={cn(
          "min-h-0 flex-1 transition-opacity",
          loading && "opacity-60",
        )}
      >
        {body}
      </div>
      {loading ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden"
        >
          <div className="bg-primary/70 h-full w-full animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}
