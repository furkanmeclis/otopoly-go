"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  addMinutes,
  differenceInMinutes,
  format,
  isSameDay,
  startOfDay,
  type Locale,
} from "date-fns";
import { useEffect, useRef } from "react";

import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils/index";

import {
  CalendarDnd,
  dragId,
  dropId,
  type DragData,
  type DropData,
} from "./calendar-dnd";
import { ChipBody, focusRing, ItemChip } from "./item-chip";
import { ItemIcon } from "./item-icon";
import {
  COLOR_CLASSES,
  type CalendarViewItem,
  type CalendarViewsProps,
} from "./types";
import { useNow } from "./use-now";
import {
  dateFnsLocale,
  dayKey,
  formatTime,
  HOUR_HEIGHT,
  itemAriaLabel,
  itemsForDay,
  layoutTimedSegments,
  MAX_DAY_ITEMS,
  minutesIntoDay,
  RESIZE_HEIGHT,
  RESIZE_MINUTES,
  SLOT_HEIGHT,
  SLOT_MINUTES,
  snapSteps,
  type TimedSegment,
} from "./utils";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const MIN_BLOCK_HEIGHT = 18;

type TimeGridViewProps = Pick<
  CalendarViewsProps,
  | "items"
  | "onDateChange"
  | "onViewChange"
  | "onItemClick"
  | "onSlotClick"
  | "onItemMove"
> & {
  days: Date[];
  dayStartHour: number;
};

export function TimeGridView({
  items,
  days,
  dayStartHour,
  onDateChange,
  onViewChange,
  onItemClick,
  onSlotClick,
  onItemMove,
}: TimeGridViewProps) {
  const { t, locale } = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const single = days.length === 1;
  const allDayLabel = t("calendar.all_day");

  useEffect(() => {
    const el = scrollRef.current;
    // A little above the hour so its label clears the sticky header.
    if (el) el.scrollTop = Math.max(0, dayStartHour * HOUR_HEIGHT - 12);
  }, [dayStartHour]);

  const openDay = (day: Date) => {
    onDateChange(day);
    onViewChange("day");
  };

  const columnsStyle = {
    gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
  };

  return (
    <CalendarDnd
      onItemMove={onItemMove}
      renderOverlay={(item) => (
        <ChipBody item={item} className="ring-border shadow-md ring-1" />
      )}
    >
      <div ref={scrollRef} className="relative h-full min-h-0 overflow-auto">
        <div className={cn("flex min-w-full flex-col", !single && "min-w-160")}>
          {/* Sticky header: day names + all-day row */}
          <div className="bg-background sticky top-0 z-20 flex border-b">
            <div className="bg-background sticky left-0 z-10 flex w-12 shrink-0 flex-col border-r sm:w-14">
              <div className="h-10" />
              <div className="text-muted-foreground flex flex-1 items-start justify-end px-1 pt-1.5 text-[10px] leading-tight sm:text-xs">
                {allDayLabel}
              </div>
            </div>
            <div className="grid flex-1" style={columnsStyle}>
              {days.map((day) => {
                const today = now !== null && isSameDay(day, now);
                return (
                  <div
                    key={dayKey(day)}
                    className="flex h-10 items-center justify-center gap-1.5 border-r text-sm last:border-r-0"
                  >
                    <span className="text-muted-foreground text-xs capitalize">
                      {format(day, single ? "EEEE" : "EEE", {
                        locale: dfLocale,
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={single}
                      aria-label={format(day, "PPPP", { locale: dfLocale })}
                      aria-current={today ? "date" : undefined}
                      onClick={() => openDay(day)}
                      className={cn(
                        "enabled:hover:bg-accent inline-flex size-7 items-center justify-center rounded-full font-semibold tabular-nums",
                        focusRing,
                        today &&
                          "bg-primary text-primary-foreground enabled:hover:bg-primary/90",
                      )}
                    >
                      {format(day, "d")}
                    </button>
                  </div>
                );
              })}
              {days.map((day) => (
                <AllDayCell
                  key={dayKey(day)}
                  day={day}
                  items={itemsForDay(items, day).filter((item) => item.allDay)}
                  limit={single ? Infinity : MAX_DAY_ITEMS}
                  dfLocale={dfLocale}
                  allDayLabel={allDayLabel}
                  moreLabel={(count) => t("calendar.more", { count })}
                  onOpenDay={openDay}
                  onItemClick={onItemClick}
                  onSlotClick={onSlotClick}
                />
              ))}
            </div>
          </div>

          {/* Time grid */}
          <div className="flex">
            <div
              aria-hidden
              className="bg-background sticky left-0 z-10 w-12 shrink-0 border-r sm:w-14"
            >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="relative"
                  style={{ height: HOUR_HEIGHT }}
                >
                  {hour > 0 ? (
                    <span className="text-muted-foreground absolute -top-2 right-1.5 text-[10px] tabular-nums sm:text-xs">
                      {`${String(hour).padStart(2, "0")}:00`}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="grid flex-1" style={columnsStyle}>
              {days.map((day) => (
                <TimeColumn
                  key={dayKey(day)}
                  day={day}
                  segments={layoutTimedSegments(items, day)}
                  nowMinutes={
                    now !== null && isSameDay(day, now)
                      ? minutesIntoDay(now, day)
                      : null
                  }
                  wide={single}
                  dfLocale={dfLocale}
                  allDayLabel={allDayLabel}
                  onItemClick={onItemClick}
                  onSlotClick={onSlotClick}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </CalendarDnd>
  );
}

function AllDayCell({
  day,
  items,
  limit,
  dfLocale,
  allDayLabel,
  moreLabel,
  onOpenDay,
  onItemClick,
  onSlotClick,
}: {
  day: Date;
  items: CalendarViewItem[];
  limit: number;
  dfLocale: Locale;
  allDayLabel: string;
  moreLabel: (count: number) => string;
  onOpenDay: (day: Date) => void;
  onItemClick: (item: CalendarViewItem) => void;
  onSlotClick: (start: Date, allDay: boolean) => void;
}) {
  const data: DropData = { day, mode: "allday" };
  const { setNodeRef, isOver } = useDroppable({
    id: dropId("allday", day),
    data,
  });
  const visible = items.slice(0, limit);
  const hidden = items.length - visible.length;

  return (
    <div
      ref={setNodeRef}
      onClick={() => onSlotClick(startOfDay(day), true)}
      className={cn(
        "flex min-h-8 min-w-0 cursor-pointer flex-col gap-0.5 border-r p-0.5 transition-colors last:border-r-0",
        isOver ? "bg-accent" : "hover:bg-muted/30",
      )}
    >
      {visible.map((item) => (
        <ItemChip
          key={item.id}
          item={item}
          day={day}
          mode="allday"
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
  );
}

function TimeColumn({
  day,
  segments,
  nowMinutes,
  wide,
  dfLocale,
  allDayLabel,
  onItemClick,
  onSlotClick,
}: {
  day: Date;
  segments: TimedSegment[];
  nowMinutes: number | null;
  wide: boolean;
  dfLocale: Locale;
  allDayLabel: string;
  onItemClick: (item: CalendarViewItem) => void;
  onSlotClick: (start: Date, allDay: boolean) => void;
}) {
  const data: DropData = { day, mode: "time" };
  const { setNodeRef, isOver } = useDroppable({
    id: dropId("time", day),
    data,
  });

  return (
    <div
      ref={setNodeRef}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const slot = Math.min(
          SLOTS_PER_DAY - 1,
          Math.max(0, Math.floor((event.clientY - rect.top) / SLOT_HEIGHT)),
        );
        onSlotClick(addMinutes(startOfDay(day), slot * SLOT_MINUTES), false);
      }}
      className={cn(
        "relative cursor-pointer border-r last:border-r-0",
        isOver && "bg-accent/40",
      )}
      style={{ height: HOUR_HEIGHT * 24 }}
    >
      {/* Hour / half-hour lines */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {HOURS.map((hour) => (
          <div key={hour} className="border-b" style={{ height: HOUR_HEIGHT }}>
            <div
              className="border-border/50 border-b border-dashed"
              style={{ height: HOUR_HEIGHT / 2 }}
            />
          </div>
        ))}
      </div>

      {segments.map((segment) => (
        <TimedBlock
          key={segment.item.id}
          day={day}
          segment={segment}
          wide={wide}
          dfLocale={dfLocale}
          allDayLabel={allDayLabel}
          onItemClick={onItemClick}
        />
      ))}

      {nowMinutes !== null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
          style={{ top: nowMinutes * PX_PER_MINUTE }}
        >
          <span className="-ml-1 size-2 -translate-y-px rounded-full bg-red-500" />
          <span className="h-0.5 flex-1 -translate-y-px bg-red-500" />
        </div>
      ) : null}
    </div>
  );
}

function TimedBlock({
  day,
  segment,
  wide,
  dfLocale,
  allDayLabel,
  onItemClick,
}: {
  day: Date;
  segment: TimedSegment;
  wide: boolean;
  dfLocale: Locale;
  allDayLabel: string;
  onItemClick: (item: CalendarViewItem) => void;
}) {
  const { item } = segment;
  const resizable = item.editable && item.resizable !== false && segment.isEnd;

  const moveData: DragData = {
    kind: "move",
    item,
    originDay: day,
    mode: "time",
  };
  const move = useDraggable({
    id: dragId("move", item, day),
    data: moveData,
    disabled: !item.editable,
  });
  const resizeData: DragData = { kind: "resize", item };
  const resize = useDraggable({
    id: dragId("resize", item, day),
    data: resizeData,
    disabled: !resizable,
  });

  const top = minutesIntoDay(segment.start, day) * PX_PER_MINUTE;
  const baseHeight = Math.max(
    MIN_BLOCK_HEIGHT,
    differenceInMinutes(segment.end, segment.start) * PX_PER_MINUTE,
  );

  // Live resize preview (transform is already snapped by the DnD modifier).
  let height = baseHeight;
  let end = item.end;
  if (resize.isDragging && resize.transform) {
    const steps = snapSteps(resize.transform.y, RESIZE_HEIGHT);
    const minEnd = addMinutes(item.start, RESIZE_MINUTES);
    const nextEnd = addMinutes(item.end, steps * RESIZE_MINUTES);
    end = nextEnd < minEnd ? minEnd : nextEnd;
    height = Math.max(
      MIN_BLOCK_HEIGHT,
      differenceInMinutes(end, segment.start) * PX_PER_MINUTE,
    );
  }

  const width = 100 / segment.columns;
  const compact = height < 36;
  const showSubtitle = wide && !!item.subtitle && height >= 52;
  const timeLabel = `${formatTime(item.start)} – ${formatTime(end)}`;

  return (
    <button
      ref={move.setNodeRef}
      type="button"
      {...move.listeners}
      aria-label={itemAriaLabel(item, allDayLabel, dfLocale)}
      onClick={(event) => {
        event.stopPropagation();
        onItemClick(item);
      }}
      className={cn(
        "group ring-background absolute flex min-w-0 flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-xs ring-1 transition-[box-shadow,opacity]",
        COLOR_CLASSES[item.color].block,
        focusRing,
        item.muted && "opacity-60",
        item.editable && "cursor-grab active:cursor-grabbing",
        !segment.isStart && "rounded-t-none",
        !segment.isEnd && "rounded-b-none",
        (move.isDragging || resize.isDragging) && "z-30 opacity-90 shadow-lg",
      )}
      style={{
        top,
        height,
        left: `calc(${segment.column * width}% + 1px)`,
        width: `calc(${width}% - 3px)`,
        transform: CSS.Translate.toString(move.transform),
      }}
    >
      <span
        className={cn(
          "flex min-w-0 items-center gap-1 leading-4",
          compact && "leading-3.5",
        )}
      >
        <ItemIcon icon={item.icon} />
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            item.muted && "line-through",
          )}
        >
          {item.title}
        </span>
        {compact ? (
          <span className="shrink-0 tabular-nums opacity-75">
            {formatTime(item.start)}
          </span>
        ) : null}
      </span>
      {!compact ? (
        <span className="truncate leading-4 tabular-nums opacity-75">
          {timeLabel}
        </span>
      ) : null}
      {showSubtitle ? (
        <span className="truncate leading-4 opacity-75">{item.subtitle}</span>
      ) : null}
      {resizable ? (
        <span
          ref={resize.setNodeRef}
          {...resize.listeners}
          aria-hidden
          onClick={(event) => event.stopPropagation()}
          className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-end justify-center"
        >
          <span className="mb-0.5 h-0.5 w-6 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-40" />
        </span>
      ) : null}
    </button>
  );
}
