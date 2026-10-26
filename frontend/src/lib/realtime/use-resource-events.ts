"use client";

import { useEffect, useRef } from "react";

import { realtimeConfig } from "@/config/realtime";
import { realtimeManager } from "@/lib/realtime/manager";
import {
  parseResourceChanged,
  type ResourceChangedEvent,
} from "@/lib/realtime/resource-events";
import type {
  RealtimeConnectionState,
  RealtimeMessage,
} from "@/lib/realtime/types";

const DEBOUNCE_MS = 400;
const DROPPED_STATES: ReadonlySet<RealtimeConnectionState> = new Set([
  "disconnected",
  "reconnecting",
  "error",
  "offline",
]);

type UseResourceEventsOptions = {
  /** Live channel, e.g. `org:{org_uuid}:resource:tenant.jobs`. Empty = off. */
  channel: string | undefined;
  /** Only events for this resource are delivered. */
  resource: string;
  /**
   * Debounced batch of events. `reconnected` is true for the single call made
   * after the connection came back from a drop (missed events are not replayed).
   */
  onEvents: (events: ResourceChangedEvent[], reconnected: boolean) => void;
  enabled?: boolean;
};

/**
 * Low-level `resource.changed` subscription for views that are not a
 * DataTable (boards, card lists, detail pages). Fail-soft: a forbidden
 * channel or a disabled realtime server leaves the page as it is.
 */
export function useResourceEvents({
  channel,
  resource,
  onEvents,
  enabled = true,
}: UseResourceEventsOptions) {
  const active = realtimeConfig.enabled && enabled && Boolean(channel);
  const handler = useRef(onEvents);
  useEffect(() => {
    handler.current = onEvents;
  });

  const buffer = useRef<ResourceChangedEvent[]>([]);
  const reconnected = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || !channel) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const flush = () => {
      timer.current = null;
      const events = buffer.current;
      const wasReconnect = reconnected.current;
      buffer.current = [];
      reconnected.current = false;
      if (events.length === 0 && !wasReconnect) return;
      handler.current(events, wasReconnect);
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    };

    const onMessage = (message: RealtimeMessage) => {
      const ev = parseResourceChanged(message);
      if (!ev || ev.resource !== resource) return;
      buffer.current.push(ev);
      schedule();
    };

    realtimeManager
      .subscribe(channel, onMessage)
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch(() => {
        // Forbidden channel / realtime unavailable: the view still works.
      });

    let connected = false;
    let dropped = false;
    const stopStatus = realtimeManager.subscribeStatus((state) => {
      if (state === "connected") {
        if (connected && dropped) {
          reconnected.current = true;
          schedule();
        }
        connected = true;
        dropped = false;
      } else if (connected && DROPPED_STATES.has(state)) {
        dropped = true;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      stopStatus();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      buffer.current = [];
    };
  }, [active, channel, resource]);
}

/** True when an event batch may touch the record `uuid`. */
export function eventsTouch(
  events: ResourceChangedEvent[],
  uuid: string,
): boolean {
  return events.some(
    (ev) =>
      ev.truncated ||
      (ev.action === "bulk" && ev.uuids.length === 0) ||
      ev.uuids.includes(uuid),
  );
}
