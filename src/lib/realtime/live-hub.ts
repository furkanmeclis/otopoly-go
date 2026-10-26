import type { QueryClient } from '@tanstack/react-query';

import { createLogger } from '@/lib/logger';

import { createBatcher, type Batcher } from './batcher';
import { invalidateLive } from './live-targets';
import { parseResourceChanged } from './resource-events';
import { organizationResourceChannel, type LiveListener, type LiveResource, type RealtimeDriver, type RealtimeState, type ResourceChangedEvent } from './types';

const log = createLogger('realtime.hub');

/** If the socket is not back this long after the app returns to the foreground, refetch anyway. */
const RESUME_FALLBACK_MS = 5000;

type Watched = {
  count: number;
  listeners: Set<LiveListener>;
  batcher: Batcher<ResourceChangedEvent>;
  unsubscribe: (() => void) | null;
  refused: boolean;
};

export type LiveHubOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  resumeFallbackMs?: number;
};

/**
 * Shared live-update hub: one realtime connection per signed-in organization, ref-counted channel
 * subscriptions per resource, debounced React Query invalidation.
 *
 * Events are hints only (no replay): after the connection comes back from a drop — network loss or the app
 * returning from the background — every watched resource is refetched once. Every failure is soft: without
 * realtime (403 / 503 / no network) screens behave exactly as before.
 */
export class LiveHub {
  private driver: RealtimeDriver | null = null;
  private stopState: (() => void) | null = null;
  private orgUuid: string | null = null;
  private qc: QueryClient | null = null;
  private watched = new Map<LiveResource, Watched>();
  private state: RealtimeState = 'idle';
  private everConnected = false;
  private dropped = false;
  private paused = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private stateListeners = new Set<(s: RealtimeState) => void>();

  constructor(private readonly options: LiveHubOptions = {}) {}

  setQueryClient(qc: QueryClient | null) {
    this.qc = qc;
  }

  getState() {
    return this.state;
  }

  getOrganization() {
    return this.orgUuid;
  }

  subscribeState(listener: (s: RealtimeState) => void) {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Connects for `orgUuid` (closes any previous organization's connection first). */
  start(orgUuid: string, createDriver: () => RealtimeDriver) {
    if (this.driver && this.orgUuid === orgUuid) return;
    this.stop();
    this.orgUuid = orgUuid;
    this.paused = false;
    try {
      this.driver = createDriver();
      this.stopState = this.driver.onState((s) => this.onDriverState(s));
      this.watched.forEach((w, resource) => this.attach(resource, w));
      this.driver.connect();
      log.info('Live updates started');
    } catch (error) {
      log.warn('Live updates could not start', { error: String(error) });
      this.driver = null;
      this.setState('unavailable');
    }
  }

  /** Sign-out / organization change: closes the connection, keeps no channel. */
  stop() {
    this.clearResumeTimer();
    this.watched.forEach((w) => {
      w.unsubscribe?.();
      w.unsubscribe = null;
      w.refused = false;
      w.batcher.cancel();
    });
    this.stopState?.();
    this.stopState = null;
    try {
      this.driver?.close();
    } catch {
      // Closing is best effort.
    }
    this.driver = null;
    this.orgUuid = null;
    this.everConnected = false;
    this.dropped = false;
    this.setState('idle');
  }

  /** App went to the background: drop the socket (subscriptions are kept for `resume`). */
  pause() {
    if (!this.driver || this.paused) return;
    this.paused = true;
    this.clearResumeTimer();
    if (this.everConnected) this.dropped = true;
    this.driver.disconnect();
  }

  /** App is active again: reconnect; the reconnect triggers one refetch of every watched resource. */
  resume() {
    if (!this.driver || !this.paused) return;
    this.paused = false;
    if (this.state === 'unavailable') return;
    this.driver.connect();
    if (this.everConnected) {
      this.clearResumeTimer();
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null;
        if (this.dropped) {
          this.dropped = false;
          this.refetchWatched();
        }
      }, this.options.resumeFallbackMs ?? RESUME_FALLBACK_MS);
    }
  }

  /** Registers interest in a resource (ref-counted); `listener` gets every debounced batch. */
  watch(resource: LiveResource, listener?: LiveListener) {
    let w = this.watched.get(resource);
    if (!w) {
      const created: Watched = {
        count: 0,
        listeners: new Set(),
        unsubscribe: null,
        refused: false,
        batcher: createBatcher<ResourceChangedEvent>((events, all) => this.flush(resource, created, events, all), {
          delayMs: this.options.debounceMs,
          maxWaitMs: this.options.maxWaitMs,
        }),
      };
      w = created;
      this.watched.set(resource, w);
      if (this.driver) this.attach(resource, w);
    }
    const entry = w;
    entry.count++;
    if (listener) entry.listeners.add(listener);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (listener) entry.listeners.delete(listener);
      entry.count--;
      if (entry.count > 0) return;
      entry.unsubscribe?.();
      entry.batcher.cancel();
      this.watched.delete(resource);
    };
  }

  /** Resources with at least one watcher (diagnostics / tests). */
  watchedResources() {
    return [...this.watched.keys()];
  }

  private attach(resource: LiveResource, w: Watched) {
    if (!this.driver || !this.orgUuid || w.unsubscribe || w.refused) return;
    const channel = organizationResourceChannel(this.orgUuid, resource);
    try {
      w.unsubscribe = this.driver.subscribe(
        channel,
        (data) => {
          const ev = parseResourceChanged(data);
          if (ev && ev.resource === resource) w.batcher.push(ev);
        },
        () => {
          // Forbidden channel: this resource simply has no live updates.
          w.refused = true;
          w.unsubscribe?.();
          w.unsubscribe = null;
        },
      );
    } catch (error) {
      log.debug('Live subscribe failed', { resource, error: String(error) });
    }
  }

  private flush(resource: LiveResource, w: Watched, events: ResourceChangedEvent[], refetchAll: boolean) {
    try {
      if (this.qc) void invalidateLive(this.qc, resource, events, refetchAll).catch(() => undefined);
    } catch (error) {
      log.debug('Live invalidation failed', { resource, error: String(error) });
    }
    w.listeners.forEach((l) => {
      try {
        l(events, refetchAll);
      } catch (error) {
        log.debug('Live listener failed', { resource, error: String(error) });
      }
    });
  }

  private refetchWatched() {
    this.watched.forEach((w) => {
      if (!w.refused) w.batcher.refetchAll();
    });
  }

  private onDriverState(next: RealtimeState) {
    if (next === 'connected') {
      if (this.everConnected && this.dropped) {
        this.dropped = false;
        this.clearResumeTimer();
        this.refetchWatched();
      }
      this.everConnected = true;
    } else if (this.everConnected && (next === 'disconnected' || next === 'connecting' || next === 'idle')) {
      this.dropped = true;
    }
    this.setState(next);
  }

  private setState(next: RealtimeState) {
    if (next === this.state) return;
    this.state = next;
    this.stateListeners.forEach((l) => l(next));
  }

  private clearResumeTimer() {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }
}

/** The app's single hub (wired by `LiveHost` in the signed-in layout). */
export const liveHub = new LiveHub();
