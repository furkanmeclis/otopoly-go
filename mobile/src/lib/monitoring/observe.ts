import { requireOptionalNativeModule } from 'expo';
import { useEffect, type ComponentType } from 'react';

import { appEnv } from '@/config/env';
import { createLogger } from '@/lib/logger';

/**
 * EAS Observe (startup and per-route performance, plus the unhandled JS errors and native crashes it
 * records on its own). See docs.expo.dev/eas/observe.
 *
 * `expo-observe` throws on import when its native module is missing (Expo Go, Node smoke tests), so it
 * is loaded only when the module exists and every export here degrades to a no-op otherwise.
 *
 * Handled errors keep going through `@/lib/monitoring` (Sentry), which scrubs PII in `beforeSend`;
 * Observe has no scrubbing hook, so `reportError` is deliberately not wired.
 */

type ObserveLib = typeof import('expo-observe');

const log = createLogger('observe');

const lib: ObserveLib | null = (() => {
  if (!requireOptionalNativeModule('ExpoObserve')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-observe') as ObserveLib;
  } catch (error) {
    log.warn('expo-observe failed to load', error);
    return null;
  }
})();

export const observeEnabled = lib !== null;

/**
 * Must run at module scope before any screen mounts (the router integration cannot be toggled later).
 * Route params that carry ids or tokens (QR login session, public quote token, record uuids) are
 * filtered; the route pattern (`/jobs/[id]`) is still reported.
 */
export function initObserve() {
  if (!lib) return;
  try {
    lib.Observe.configure({
      environment: appEnv,
      integrations: {
        'expo-router': { filteredParams: ['id', 'uuid', 'token', 'job_uuid', 'customer', 'lead', 'todo', 'account', 'to'] },
      },
    });
  } catch (error) {
    log.warn('Observe configure failed', error);
  }
}

/** Wraps the root layout so time to first render is measured; identity where Observe is unavailable. */
export function withObserveRoot(Component: ComponentType<Record<string, unknown>>) {
  return lib ? lib.ObserveRoot.wrap(Component) : Component;
}

const noop = () => {};
const useNoopObserve = () => ({ markInteractive: noop });

/**
 * Marks the current screen interactive (time to interactive, scoped to the route) once `ready` is true.
 * Call it on every screen the app can open on: only the first call per session sets the app-wide TTI.
 */
export function useMarkInteractive(ready = true) {
  const { markInteractive } = (lib?.useObserve ?? useNoopObserve)();
  useEffect(() => {
    if (ready) markInteractive();
  }, [ready, markInteractive]);
}
