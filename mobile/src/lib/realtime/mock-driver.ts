import { createLogger } from '@/lib/logger';

import { realtimeService } from './service';
import type { RealtimeDriver, RealtimeState } from './types';

const log = createLogger('realtime.mock');

type Entry = { onData: (data: unknown) => void; onError?: (error: unknown) => void; ok: boolean };

/**
 * Demo / test driver: asks the (mock) API for the same tokens as the real client — so the permission rules
 * of the subscription token apply — but never opens a socket and emits nothing on its own. Tests push
 * publications with `emit` and simulate drops with `drop` / `restore`.
 */
export type MockRealtimeDriver = RealtimeDriver & {
  emit(channel: string, data: unknown): void;
  drop(): void;
  restore(): void;
  channels(): string[];
};

export function createMockDriver(): MockRealtimeDriver {
  let state: RealtimeState = 'idle';
  let opened = false;
  const listeners = new Set<(s: RealtimeState) => void>();
  const channels = new Map<string, Entry>();
  const setState = (next: RealtimeState) => {
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l(next));
  };
  const check = (channel: string, entry: Entry) => {
    realtimeService
      .subscriptionToken(channel)
      .then(() => {
        entry.ok = true;
      })
      .catch((error) => {
        log.debug('Mock channel refused', { channel });
        entry.onError?.(error);
      });
  };

  return {
    connect() {
      setState('connecting');
      const first = !opened;
      opened = true;
      if (!first) {
        setState('connected');
        return;
      }
      realtimeService
        .connectionToken()
        .then(() => {
          setState('connected');
          channels.forEach((entry, channel) => check(channel, entry));
        })
        .catch(() => setState('unavailable'));
    },
    disconnect() {
      setState('idle');
    },
    close() {
      channels.clear();
      opened = false;
      setState('idle');
      listeners.clear();
    },
    subscribe(channel, onData, onError) {
      const entry: Entry = { onData, onError, ok: false };
      channels.set(channel, entry);
      if (state === 'connected') check(channel, entry);
      return () => {
        if (channels.get(channel) === entry) channels.delete(channel);
      };
    },
    onState(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    emit(channel, data) {
      const entry = channels.get(channel);
      if (entry?.ok && state === 'connected') entry.onData(data);
    },
    drop() {
      setState('disconnected');
    },
    restore() {
      setState('connected');
    },
    channels: () => [...channels.entries()].filter(([, e]) => e.ok).map(([c]) => c),
  };
}
