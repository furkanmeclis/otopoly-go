"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Locale } from "date-fns";

import { cn } from "@/lib/utils/index";

import { dragId, type DragData, type DropMode } from "./calendar-dnd";
import { ItemIcon } from "./item-icon";
import { COLOR_CLASSES, type CalendarViewItem } from "./types";
import { formatTime, itemAriaLabel } from "./utils";

export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Purely presentational chip body, also used inside the drag overlay. */
export function ChipBody({
  item,
  showTime = true,
  className,
}: {
  item: CalendarViewItem;
  showTime?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs leading-5",
        COLOR_CLASSES[item.color].chip,
        item.muted && "opacity-60",
        className,
      )}
    >
      {!item.allDay && !item.icon ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            COLOR_CLASSES[item.color].dot,
          )}
        />
      ) : null}
      <ItemIcon icon={item.icon} />
      {!item.allDay && showTime ? (
        <span className="shrink-0 tabular-nums opacity-80">
          {formatTime(item.start)}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate font-medium",
          item.muted && "line-through",
        )}
      >
        {item.title}
      </span>
    </span>
  );
}

/** Draggable (when editable) chip used in month cells and the all-day row. */
export function ItemChip({
  item,
  day,
  mode,
  allDayLabel,
  dfLocale,
  onItemClick,
  className,
}: {
  item: CalendarViewItem;
  day: Date;
  mode: DropMode;
  allDayLabel: string;
  dfLocale: Locale;
  onItemClick: (item: CalendarViewItem) => void;
  className?: string;
}) {
  const data: DragData = { kind: "move", item, originDay: day, mode };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: dragId("move", item, day),
    data,
    disabled: !item.editable,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      aria-label={itemAriaLabel(item, allDayLabel, dfLocale)}
      onClick={(event) => {
        event.stopPropagation();
        onItemClick(item);
      }}
      className={cn(
        "flex w-full min-w-0 rounded-sm",
        focusRing,
        item.editable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        className,
      )}
    >
      <ChipBody item={item} />
    </button>
  );
}
