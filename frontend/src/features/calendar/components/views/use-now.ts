"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(onChange: () => void) {
  let interval: ReturnType<typeof setInterval> | undefined;
  // Align ticks with the start of each minute.
  const timeout = setTimeout(
    () => {
      onChange();
      interval = setInterval(onChange, MINUTE);
    },
    MINUTE - (Date.now() % MINUTE),
  );
  return () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
}

function getSnapshot() {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

function getServerSnapshot() {
  return 0;
}

/**
 * Current time truncated to the minute, updated every minute.
 * Returns `null` during SSR / hydration so markup stays deterministic.
 */
export function useNow(): Date | null {
  const ms = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return ms === 0 ? null : new Date(ms);
}
