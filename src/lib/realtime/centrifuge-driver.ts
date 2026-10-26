import { Centrifuge, UnauthorizedError, type Subscription } from 'centrifuge';

import { isApiError } from '@/api/errors';
import { createLogger } from '@/lib/logger';

import { realtimeService } from './service';
import type { RealtimeDriver, RealtimeState } from './types';

const log = createLogger('realtime');

/** 401 / 403 / 503 are answers ("not for you", "switched off"): stop instead of retrying forever. */
const isRefusal = (error: unknown) => isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 503);

type Entry = { onData: (data: unknown) => void; onError?: (error: unknown) => void; sub: Subscription | null };

/**
 * One Centrifugo WebSocket for the signed-in organization (`centrifuge` JS SDK; React Native has a global
 * WebSocket). The first connection token also tells the socket URL; later tokens are fetched by the SDK
 * through `getToken`. Each channel gets its own subscription token.
 */
export function createCentrifugeDriver(): RealtimeDriver {
  let client: Centrifuge | null = null;
  let starting = false;
  let closed = false;
  let state: RealtimeState = 'idle';
  const listeners = new Set<(s: RealtimeState) => void>();
  const channels = new Map<string, Entry>();

  const setState = (next: RealtimeState) => {
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l(next));
  };

  const attach = (channel: string, entry: Entry) => {
    if (!client || entry.sub) return;
    const sub =
      client.getSubscription(channel) ??
      client.newSubscription(channel, {
        getToken: async () => {
          try {
            return (await realtimeService.subscriptionToken(channel)).token;
          } catch (error) {
            if (isRefusal(error)) throw new UnauthorizedError('subscription refused');
            throw error;
          }
        },
      });
    sub.on('publication', (ctx) => {
      try {
        entry.onData(ctx.data);
      } catch (error) {
        log.warn('Live listener failed', { channel, error: String(error) });
      }
    });
    sub.on('unsubscribed', (ctx) => {
      // Server- or token-side refusal (not our own unsubscribe): the view keeps working without live updates.
      if (ctx.code !== 0 && ctx.code !== 2) {
        log.info('Live channel refused', { channel, code: ctx.code, reason: ctx.reason });
        entry.onError?.(ctx);
      }
    });
    entry.sub = sub;
    sub.subscribe();
  };

  const start = async () => {
    if (client || starting) return;
    starting = true;
    setState('connecting');
    try {
      const first = await realtimeService.connectionToken();
      if (closed) return;
      const next = new Centrifuge(first.ws_url, {
        token: first.token,
        getToken: async () => {
          try {
            return (await realtimeService.connectionToken()).token;
          } catch (error) {
            if (isRefusal(error)) throw new UnauthorizedError('connection refused');
            throw error;
          }
        },
        minReconnectDelay: 1000,
        maxReconnectDelay: 20000,
      });
      next.on('connecting', () => setState('connecting'));
      next.on('connected', () => setState('connected'));
      next.on('disconnected', (ctx) => {
        // 0: our own disconnect (background); 1: token refused; 3500+: server said "do not reconnect".
        setState(ctx.code === 0 ? 'idle' : ctx.code === 1 || ctx.code >= 3500 ? 'unavailable' : 'disconnected');
      });
      next.on('error', (ctx) => log.debug('Realtime error', { type: ctx.type, message: ctx.error?.message }));
      client = next;
      channels.forEach((entry, channel) => attach(channel, entry));
      next.connect();
    } catch (error) {
      log.info('Realtime unavailable', isApiError(error) ? { status: error.status, code: error.code } : { error: String(error) });
      setState(isRefusal(error) ? 'unavailable' : 'disconnected');
    } finally {
      starting = false;
    }
  };

  return {
    connect() {
      closed = false;
      if (client) client.connect();
      else void start();
    },
    disconnect() {
      client?.disconnect();
      setState('idle');
    },
    close() {
      closed = true;
      channels.forEach((entry) => {
        entry.sub?.removeAllListeners();
        entry.sub?.unsubscribe();
      });
      channels.clear();
      client?.disconnect();
      client = null;
      setState('idle');
      listeners.clear();
    },
    subscribe(channel, onData, onError) {
      const entry: Entry = { onData, onError, sub: null };
      channels.set(channel, entry);
      attach(channel, entry);
      return () => {
        if (channels.get(channel) !== entry) return;
        channels.delete(channel);
        if (entry.sub) {
          entry.sub.removeAllListeners();
          entry.sub.unsubscribe();
          client?.removeSubscription(entry.sub);
        }
      };
    },
    onState(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}
