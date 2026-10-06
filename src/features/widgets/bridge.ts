import { requireOptionalNativeModule } from 'expo';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { LiveActivity, LiveActivityFactory, Widget } from 'expo-widgets';
import { Platform } from 'react-native';

import { createLogger } from '@/lib/logger';
import { prefs } from '@/lib/storage';
import type { JobActivityProps, TodayWidgetProps } from '@/widgets/types';

const log = createLogger('widgets');

type Bridge = {
  /** Every Home / Lock Screen widget on this platform; all of them render TodayWidgetProps. */
  widgets: Widget<TodayWidgetProps>[];
  /** Job Live Activities (iOS only). */
  jobActivity: LiveActivityFactory<JobActivityProps> | null;
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
            jobActivity: null,
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
/** Live Activities are iOS-only; Android widgets have no equivalent. */
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
  void endAllJobActivities();
}

// ─── Job Live Activities ───────────────────────────────────────────────────

const ACTIVITY_KEY = 'widgets.job_activities';
/** activityId → jobId, so running activities can be matched to jobs after a relaunch. */
type ActivityIndex = Record<string, string>;

async function readIndex(): Promise<ActivityIndex> {
  return prefs.get<ActivityIndex>(ACTIVITY_KEY, {});
}

export async function findJobActivity(jobId: string): Promise<LiveActivity<JobActivityProps> | null> {
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
export async function runningJobActivities(): Promise<Map<string, LiveActivity<JobActivityProps>>> {
  const out = new Map<string, LiveActivity<JobActivityProps>>();
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
  try {
    const existing = await findJobActivity(props.jobId);
    if (existing) {
      await existing.update(props);
      return true;
    }
    const activity = factory.start(props, `otopoly://jobs/${props.jobId}`);
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
export async function updateJobActivity(activity: LiveActivity<JobActivityProps>, props: JobActivityProps) {
  try {
    if (props.status === 'delivered' || props.status === 'cancelled') {
      await activity.end('default', props, new Date());
      log.info('Live Activity ended', { jobId: props.jobId, status: props.status });
    } else {
      await activity.update(props);
    }
  } catch (error) {
    log.warn('Live Activity update failed', error);
  }
}

export async function endJobActivity(jobId: string) {
  const activity = await findJobActivity(jobId);
  if (!activity) return;
  try {
    await activity.end('immediate');
    log.info('Live Activity stopped', { jobId });
  } catch (error) {
    log.warn('Live Activity stop failed', error);
  }
}

export async function endAllJobActivities() {
  const factory = getWidgetBridge()?.jobActivity;
  if (!factory) return;
  try {
    await Promise.all(factory.getInstances().map((a) => a.end('immediate')));
    await prefs.remove(ACTIVITY_KEY);
  } catch (error) {
    log.warn('Ending Live Activities failed', error);
  }
}
