/**
 * Tells the backend which job activities run on this device and which organization its widgets show,
 * so otopoly-go (modules/livepush) can update them while the app is closed. See docs/LIVE_WIDGETS.md.
 *
 * Pure bookkeeping with injected dependencies (no React Native imports): bridge.ts wires the real
 * platform, service and push token; the smoke tests drive it against the mock API.
 */
import { isApiError } from '@/api/errors';
import type { createLogger } from '@/lib/logger';

import type { liveActivitiesService } from './services/live-activities.service';

type Logger = ReturnType<typeof createLogger>;

/** ActivityKit push tokens rotate; re-send an unchanged registration only this often (server keeps it 12 h). */
export const REREGISTER_AFTER_MS = 6 * 60 * 60 * 1000;

export type PushTokenEvent = { activityId: string; pushToken: string };

/** expo-widgets' LiveActivity on iOS (push token API); the Android handle has none of the optional members. */
export type PushCapableActivity = {
  getId(): string;
  getPushToken?: () => Promise<string | null>;
  addPushTokenListener?: (listener: (event: PushTokenEvent) => void) => { remove(): void };
};

type Deps = {
  platform: 'ios' | 'android' | 'other';
  service: Pick<typeof liveActivitiesService, 'registerActivity' | 'unregisterActivity' | 'registerDevice'>;
  /** The device's Expo push token (null until push is registered). */
  deviceToken: () => Promise<string | null>;
  locale: () => string;
  now?: () => number;
  log?: Logger;
};

export function createActivityPushRegistry(deps: Deps) {
  const now = deps.now ?? Date.now;
  /** activityId → jobId for everything tracked in this process. */
  const jobs = new Map<string, string>();
  const subs = new Map<string, { remove(): void }>();
  const sent = new Map<string, { key: string; at: number }>();

  async function register(jobId: string, activityId: string, pushToken?: string) {
    const device = await deps.deviceToken();
    if (deps.platform === 'android' && !device) return false;
    const key = `${jobId}|${pushToken ?? ''}|${device ?? ''}`;
    const last = sent.get(activityId);
    if (last && last.key === key && now() - last.at < REREGISTER_AFTER_MS) return true;
    try {
      await deps.service.registerActivity(jobId, {
        platform: deps.platform === 'ios' ? 'ios' : 'android',
        activity_id: activityId,
        ...(pushToken ? { push_token: pushToken } : {}),
        ...(device ? { device_token: device } : {}),
        locale: deps.locale(),
      });
      sent.set(activityId, { key, at: now() });
      deps.log?.info('Live Activity registered for push', { jobId, rotated: Boolean(last && last.key !== key) });
      return true;
    } catch (error) {
      deps.log?.warn('Live Activity push registration failed', isApiError(error) ? error.code : error);
      return false;
    }
  }

  return {
    /**
     * Registers a running activity (start, relaunch) and follows its token rotations. iOS: the
     * ActivityKit push token arrives asynchronously, so the listener does the first registration too.
     */
    async track(jobId: string, activity: PushCapableActivity) {
      if (deps.platform === 'other') return;
      const id = deps.platform === 'android' ? jobId : activity.getId();
      jobs.set(id, jobId);
      if (deps.platform === 'android') {
        await register(jobId, id);
        return;
      }
      if (!subs.has(id) && activity.addPushTokenListener) {
        subs.set(
          id,
          activity.addPushTokenListener((event) => {
            if (event.activityId === id && event.pushToken) void register(jobId, id, event.pushToken);
          }),
        );
      }
      try {
        const token = (await activity.getPushToken?.()) ?? null;
        if (token) await register(jobId, id, token);
      } catch (error) {
        deps.log?.debug('Live Activity push token not ready', error);
      }
    },

    /** Forgets a job's activities here and on the server (best effort, never throws). */
    async untrack(jobId: string, options: { server?: boolean } = {}) {
      const ids = [...jobs.entries()].filter(([, j]) => j === jobId).map(([id]) => id);
      for (const id of ids) {
        subs.get(id)?.remove();
        subs.delete(id);
        sent.delete(id);
        jobs.delete(id);
      }
      if (options.server === false || deps.platform === 'other') return;
      try {
        const device = await deps.deviceToken();
        await deps.service.unregisterActivity(jobId, deps.platform === 'android' && device ? { activity_id: jobId, device_token: device } : {});
      } catch (error) {
        deps.log?.warn('Live Activity push unregister failed', isApiError(error) ? error.code : error);
      }
    },

    /** Sign-out / organization switch. `server: false` when the session or organization is already gone. */
    async untrackAll(options: { server?: boolean } = {}) {
      const all = [...new Set(jobs.values())];
      await Promise.all(all.map((jobId) => this.untrack(jobId, options)));
    },

    trackedJobIds: () => [...new Set(jobs.values())],
  };
}

export type ActivityPushRegistry = ReturnType<typeof createActivityPushRegistry>;

export type WidgetDeviceState = { orgUuid: string; orgName: string };

/**
 * Links this device's widgets to the active organization (and stores the iOS push-to-start token),
 * so `widgets.refresh` pushes reach it. Re-sent when the organization, the Expo token or the
 * push-to-start token changes, otherwise at most every REREGISTER_AFTER_MS.
 */
export function createWidgetDeviceLink(deps: Pick<Deps, 'service' | 'deviceToken' | 'now' | 'log'>) {
  const now = deps.now ?? Date.now;
  let last: { key: string; at: number } | null = null;
  let pushToStart = '';

  async function sync(state: WidgetDeviceState) {
    const device = await deps.deviceToken();
    if (!device) return false;
    const key = `${state.orgUuid}|${device}|${pushToStart}`;
    if (last && last.key === key && now() - last.at < REREGISTER_AFTER_MS) return true;
    try {
      await deps.service.registerDevice({ device_token: device, push_to_start_token: pushToStart, widgets: true });
      last = { key, at: now() };
      deps.log?.info('Widget device linked', { pushToStart: Boolean(pushToStart) });
      return true;
    } catch (error) {
      deps.log?.warn('Widget device link failed', isApiError(error) ? error.code : error);
      return false;
    }
  }

  return {
    sync,
    setPushToStartToken(token: string) {
      pushToStart = token;
    },
    reset() {
      last = null;
    },
  };
}
