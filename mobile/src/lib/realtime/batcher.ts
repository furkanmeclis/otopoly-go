/**
 * Trailing debounce for live events: a burst (bulk edit, import, several devices) becomes one flush.
 * `maxWaitMs` bounds the delay while events keep arriving. `refetchAll` (reconnect, app back in the
 * foreground) joins the same flush.
 */
export type Batcher<T> = {
  push(item: T): void;
  refetchAll(): void;
  cancel(): void;
};

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void; now: () => number };
const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createBatcher<T>(
  flush: (items: T[], refetchAll: boolean) => void,
  { delayMs = 400, maxWaitMs = 2000, timers = defaultTimers }: { delayMs?: number; maxWaitMs?: number; timers?: Timers } = {},
): Batcher<T> {
  let items: T[] = [];
  let all = false;
  let handle: unknown = null;
  let firstAt = 0;

  const run = () => {
    handle = null;
    const batch = items;
    const refetch = all;
    items = [];
    all = false;
    firstAt = 0;
    if (!batch.length && !refetch) return;
    flush(batch, refetch);
  };
  const schedule = () => {
    const now = timers.now();
    if (!firstAt) firstAt = now;
    if (handle !== null) timers.clear(handle);
    handle = timers.set(run, Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now)));
  };

  return {
    push(item) {
      items.push(item);
      schedule();
    },
    refetchAll() {
      all = true;
      schedule();
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      items = [];
      all = false;
      firstAt = 0;
    },
  };
}
