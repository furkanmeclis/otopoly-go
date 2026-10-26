import { useEffect, useRef } from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import type { Permission } from '@/features/auth/permissions';
import { liveHub } from '@/lib/realtime/live-hub';
import { LIVE_TARGETS } from '@/lib/realtime/live-targets';
import type { LiveListener, LiveResource } from '@/lib/realtime/types';

export type { LiveResource } from '@/lib/realtime/types';
export { eventsTouch } from '@/lib/realtime/resource-events';

type Options = {
  /**
   * Called with every debounced batch after the matching queries were invalidated. `reconnected` is true
   * for the single call made after the connection came back (missed events are not replayed).
   */
  onEvent?: LiveListener;
  enabled?: boolean;
};

/**
 * Live updates for a screen: while it is mounted, changes to `resources` in the active organization
 * invalidate the matching React Query keys (lists, summaries, and detail queries whose uuid is in the
 * event; see `lib/realtime/live-targets.ts`), debounced ~400 ms. Resources the member may not read are
 * skipped (the backend would refuse their channel anyway). Fail-soft: without realtime nothing changes.
 */
export function useLiveResource(resources: LiveResource | readonly LiveResource[], { onEvent, enabled = true }: Options = {}) {
  const { can } = useAuth();
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const list = (typeof resources === 'string' ? [resources] : resources).filter((r) => can({ perm: LIVE_TARGETS[r]?.perm as Permission }));
  const key = list.join(',');
  useEffect(() => {
    if (!enabled || !key) return;
    const listener: LiveListener = (events, reconnected) => handler.current?.(events, reconnected);
    const releases = (key.split(',') as LiveResource[]).map((r) => liveHub.watch(r, listener));
    return () => releases.forEach((release) => release());
  }, [key, enabled]);
}
