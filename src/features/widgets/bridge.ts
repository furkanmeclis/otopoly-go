import { requireOptionalNativeModule } from 'expo';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { Widget } from 'expo-widgets';
import { Platform } from 'react-native';

import { getCurrentLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';
import type { JobActivityProps, TodayWidgetProps } from '@/widgets/types';

import { androidJobActivityFactory, ensureAndroidNotificationPermission } from './android-live-updates';
import { createActivityPushRegistry, createWidgetDeviceLink, type PushTokenEvent } from './live-push';
import { liveActivitiesService } from './services/live-activities.service';

const log = createLogger('widgets');

/**
 * One running job activity: an ActivityKit Live Activity on iOS, a Live Update notification on Android.
 * expo-widgets' LiveActivity / LiveActivityFactory satisfy these shapes as they are.
 */
export type JobActivityHandle = {
  getId(): string;
  update(props: JobActivityProps): Promise<void>;
  end(dismissal?: 'default' | 'immediate', props?: JobActivityProps, contentDate?: Date): Promise<void>;
  /** iOS only (expo-widgets with enablePushNotifications): the ActivityKit push token for server updates. */
  getPushToken?: () => Promise<string | null>;
  addPushTokenListener?: (listener: (event: PushTokenEvent) => void) => { remove(): void };
};

export type JobActivityFactory = {
  getInstances(): JobActivityHandle[];
  start(props: JobActivityProps, url: string): JobActivityHandle;
};

type Bridge = {
  /** Every Home / Lock Screen widget on this platform; all of them render TodayWidgetProps. */
  widgets: Widget<TodayWidgetProps>[];
  /** Job Live Activities (iOS) / Live Updates (Android); null where neither is available. */
  jobActivity: JobActivityFactory | null;
  directory: string | null;
};

let bridge: Bridge | null | undefined;

/**
 * Lazily loads the widget definitions. Returns null where the native module is missing
 * (Expo Go, web) so callers can treat widgets as an optional enhancement.
 */
export function getWidgetBridge(): Bridge | null {
  if (bridge !== undefined) return bridge;
  bridge = null;
  if ((Platform.OS !== 'ios' && Platform.OS !== 'android') || !requireOptionalNativeModule('ExpoWidgets')) {
    log.info('Widgets unavailable in this runtime');
    return bridge;
  }
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    bridge =
      Platform.OS === 'ios'
        ? {
            widgets: [require('@/widgets/today-widget').default, require('@/widgets/glance-widget').default],
            jobActivity: require('@/widgets/job-activity').default,
            directory: require('expo-widgets').widgetsDirectory || null,
          }
        : {
            widgets: [require('@/widgets/android/today-widget').default, require('@/widgets/android/queue-widget').default],
            jobActivity: androidJobActivityFactory(),
            directory: require('expo-widgets').widgetsDirectory || null,
          };
    /* eslint-enable @typescript-eslint/no-require-imports */
    log.info('Widgets ready', { platform: Platform.OS, directory: Boolean(bridge?.directory) });
  } catch (error) {
    log.error('Widget bridge failed to load', error);
    bridge = null;
  }
  return bridge;
}

export const widgetsAvailable = () => getWidgetBridge() !== null;

// ─── Server-side updates while the app is closed (docs/LIVE_WIDGETS.md) ────

const pushDeps = {
  service: liveActivitiesService,
  deviceToken: () => prefs.get<string | null>(StorageKeys.pushToken, null),
  log,
};

/** Registers running job activities with the backend so it can update them over APNs / FCM. */
export const activityPush = createActivityPushRegistry({
  ...pushDeps,
  platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other',
  locale: getCurrentLocale,
});

/** Links this device's widgets to the active organization for background refresh pushes. */
export const widgetDevice = createWidgetDeviceLink(pushDeps);

const WIDGET_ORG_KEY = 'widgets.org';
export type WidgetOrg = { uuid: string; name: string };

/** The organization the widgets show; background pushes for any other organization are ignored. */
export const widgetOrg = {
  get: () => prefs.get<WidgetOrg | null>(WIDGET_ORG_KEY, null),
  set: (org: WidgetOrg) => prefs.set(WIDGET_ORG_KEY, org),
  clear: () => prefs.remove(WIDGET_ORG_KEY),
};
/** iOS Live Activities or Android Live Updates (local module `otopoly-live-updates`). */
export const liveActivitiesAvailable = () => Boolean(getWidgetBridge()?.jobActivity);

// ─── Brand tile shared with the widget extension ───────────────────────────

let logoUri: Promise<string> | null = null;

/** Copies the brand tile into the folder the widget runtime reads (app group on iOS) once per launch; '' when it cannot. */
export function ensureWidgetLogo(): Promise<string> {
  logoUri ??= (async () => {
    const dir = getWidgetBridge()?.directory;
    if (!dir) return '';
    try {
      const asset = Asset.fromModule(require('../../../assets/brand/widget-tile.png'));
      await asset.downloadAsync();
      const target = new File(dir, 'otopoly-tile.png');
      if (!target.exists && asset.localUri) new File(asset.localUri).copy(target);
      return target.uri;
    } catch (error) {
      log.warn('Widget logo copy failed', error);
      return '';
    }
  })();
  return logoUri;
}

// ─── Home / Lock Screen widgets ────────────────────────────────────────────

let lastSnapshot = '';
let lastProps: TodayWidgetProps | null = null;

/** Pushes new props to every widget; skips identical snapshots so the reload budget (WidgetKit / Glance) is not wasted. */
export function pushTodaySnapshot(props: TodayWidgetProps) {
  const b = getWidgetBridge();
  if (!b) return;
  const { updatedAt, updatedTime, ...comparable } = props;
  const key = JSON.stringify(comparable);
  if (key === lastSnapshot) return;
  try {
    for (const widget of b.widgets) widget.updateSnapshot(props);
    lastSnapshot = key;
    lastProps = props;
    log.debug('Widget snapshot pushed', { state: props.state, queue: props.queue.length, at: updatedAt });
  } catch (error) {
    log.error('Widget snapshot failed', error);
  }
}

/** Replaces business data with a signed-out card (no figures stay on the Home Screen after logout). */
export function clearWidgetsForSignOut() {
  widgetDevice.reset();
  void widgetOrg.clear();
  // The session is gone already: the server rows go with the push device / expire on their own.
  void endAllJobActivities({ server: false });
  if (!lastProps) return;
  pushTodaySnapshot({
    ...lastProps,
    state: 'signedOut',
    org: '',
    showMoney: false,
    stats: { inProgress: 0, ready: 0, delivered: 0, stale: 0, collected: '' },
    queue: [],
    updatedAt: Date.now(),
    updatedTime: '',
  });
}

// ─── Job Live Activities ───────────────────────────────────────────────────

const ACTIVITY_KEY = 'widgets.job_activities';
/** activityId → jobId, so running activities can be matched to jobs after a relaunch. */
type ActivityIndex = Record<string, string>;

async function readIndex(): Promise<ActivityIndex> {
  return prefs.get<ActivityIndex>(ACTIVITY_KEY, {});
}

export async function findJobActivity(jobId: string): Promise<JobActivityHandle | null> {
  const factory = getWidgetBridge()?.jobActivity;
  if (!factory) return null;
  try {
    const index = await readIndex();
    return factory.getInstances().find((a) => index[a.getId()] === jobId) ?? null;
  } catch (error) {
    log.warn('Live Activity lookup failed', error);
    return null;
  }
}

/** Running job activities keyed by job id. */
export async function runningJobActivities(): Promise<Map<string, JobActivityHandle>> {
  const out = new Map<string, JobActivityHandle>();
  const factory = getWidgetBridge()?.jobActivity;
  if (!factory) return out;
  try {
    const index = await readIndex();
    for (const activity of factory.getInstances()) {
      const jobId = index[activity.getId()];
      if (jobId) out.set(jobId, activity);
    }
  } catch (error) {
    log.warn('Live Activity listing failed', error);
  }
  return out;
}

export async function startJobActivity(props: JobActivityProps): Promise<boolean> {
  const factory = getWidgetBridge()?.jobActivity;
  if (!factory) return false;
  if (Platform.OS === 'android' && !(await ensureAndroidNotificationPermission())) {
    log.warn('Live Update not started: notifications are disabled');
    return false;
  }
  try {
    const existing = await findJobActivity(props.jobId);
    if (existing) {
      await existing.update(props);
      void activityPush.track(props.jobId, existing);
      return true;
    }
    const activity = factory.start(props, `otopoly://jobs/${props.jobId}`);
    void activityPush.track(props.jobId, activity);
    const index = await readIndex();
    // Drop entries whose activity is gone so the index does not grow forever.
    const alive = new Set(factory.getInstances().map((a) => a.getId()));
    const next: ActivityIndex = { [activity.getId()]: props.jobId };
    for (const [id, jobId] of Object.entries(index)) if (alive.has(id)) next[id] = jobId;
    await prefs.set(ACTIVITY_KEY, next);
    log.info('Live Activity started', { jobId: props.jobId });
    return true;
  } catch (error) {
    log.error('Live Activity start failed', error);
    return false;
  }
}

/** Updates a running activity; finished jobs are shown one last time and then dismissed by the system. */
export async function updateJobActivity(activity: JobActivityHandle, props: JobActivityProps) {
  try {
    if (props.status === 'delivered' || props.status === 'cancelled') {
      await activity.end('default', props, new Date());
      void activityPush.untrack(props.jobId);
      log.info('Live Activity ended', { jobId: props.jobId, status: props.status });
    } else {
      await activity.update(props);
    }
  } catch (error) {
    log.warn('Live Activity update failed', error);
  }
}

export async function endJobActivity(jobId: string) {
  void activityPush.untrack(jobId);
  const activity = await findJobActivity(jobId);
  if (!activity) return;
  try {
    await activity.end('immediate');
    log.info('Live Activity stopped', { jobId });
  } catch (error) {
    log.warn('Live Activity stop failed', error);
  }
}

/** `server: false` when the session or organization already changed (the backend rows expire on their own). */
export async function endAllJobActivities(options: { server?: boolean } = {}) {
  await activityPush.untrackAll(options);
  const factory = getWidgetBridge()?.jobActivity;
  if (!factory) return;
  try {
    await Promise.all(factory.getInstances().map((a) => a.end('immediate')));
    await prefs.remove(ACTIVITY_KEY);
  } catch (error) {
    log.warn('Ending Live Activities failed', error);
  }
}
