"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { addDays, addMinutes, differenceInCalendarDays } from "date-fns";
import { useState, type ReactNode } from "react";

import type { CalendarViewItem } from "./types";
import {
  RESIZE_HEIGHT,
  RESIZE_MINUTES,
  SLOT_HEIGHT,
  SLOT_MINUTES,
  snapSteps,
} from "./utils";

/** Where an item lives / is dropped: month cell, all-day row cell or time column. */
export type DropMode = "month" | "allday" | "time";

export type DragData =
  | {
      kind: "move";
      item: CalendarViewItem;
      originDay: Date;
      mode: DropMode;
    }
  | { kind: "resize"; item: CalendarViewItem };

export type DropData = { day: Date; mode: DropMode };

export function dragId(
  kind: DragData["kind"],
  item: CalendarViewItem,
  day: Date,
) {
  return `${kind}:${item.id}:${day.getTime()}`;
}

export function dropId(mode: DropMode, day: Date) {
  return `drop:${mode}:${day.getTime()}`;
}

const snapModifier: Modifier = ({ transform, active }) => {
  const data = active?.data.current as DragData | undefined;
  if (!data) return transform;
  if (data.kind === "resize") {
    return {
      ...transform,
      x: 0,
      y: snapSteps(transform.y, RESIZE_HEIGHT) * RESIZE_HEIGHT,
    };
  }
  if (data.mode === "time") {
    return {
      ...transform,
      y: snapSteps(transform.y, SLOT_HEIGHT) * SLOT_HEIGHT,
    };
  }
  return transform;
};

const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

function computeMove(event: DragEndEvent): { start: Date; end: Date } | null {
  const data = event.active.data.current as DragData | undefined;
  if (!data) return null;
  const { item } = data;

  if (data.kind === "resize") {
    const steps = snapSteps(event.delta.y, RESIZE_HEIGHT);
    if (steps === 0) return null;
    const minEnd = addMinutes(item.start, RESIZE_MINUTES);
    let end = addMinutes(item.end, steps * RESIZE_MINUTES);
    if (end < minEnd) end = minEnd;
    if (end.getTime() === item.end.getTime()) return null;
    return { start: item.start, end };
  }

  const drop = event.over?.data.current as DropData | undefined;
  if (data.mode === "time") {
    // Day view: dragging sideways out of the single column still moves in time.
    const days =
      drop && drop.mode === "time"
        ? differenceInCalendarDays(drop.day, data.originDay)
        : 0;
    const minutes = snapSteps(event.delta.y, SLOT_HEIGHT) * SLOT_MINUTES;
    if (days === 0 && minutes === 0) return null;
    return {
      start: addMinutes(addDays(item.start, days), minutes),
      end: addMinutes(addDays(item.end, days), minutes),
    };
  }

  if (!drop || drop.mode !== data.mode) return null;
  const days = differenceInCalendarDays(drop.day, data.originDay);
  if (days === 0) return null;
  return { start: addDays(item.start, days), end: addDays(item.end, days) };
}

export function CalendarDnd({
  onItemMove,
  renderOverlay,
  children,
}: {
  onItemMove?: (item: CalendarViewItem, start: Date, end: Date) => void;
  /** Overlay for chip-style drags (month / all-day row). */
  renderOverlay: (item: CalendarViewItem) => ReactNode;
  children: ReactNode;
}) {
  const [overlayItem, setOverlayItem] = useState<CalendarViewItem | null>(null);
  const sensors = useSensors(
    // Pointer only: Enter/Space on a focused item must keep acting as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    setOverlayItem(
      data && data.kind === "move" && data.mode !== "time" ? data.item : null,
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setOverlayItem(null);
    const data = event.active.data.current as DragData | undefined;
    if (!data || !data.item.editable || !onItemMove) return;
    const next = computeMove(event);
    if (next) onItemMove(data.item, next.start, next.end);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[snapModifier]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setOverlayItem(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {overlayItem ? renderOverlay(overlayItem) : null}
      </DragOverlay>
    </DndContext>
  );
}
