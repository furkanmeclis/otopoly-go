import LiveUpdates, { type JobLiveUpdate } from '../../../modules/otopoly-live-updates';

import { notificationsModule } from '@/features/notifications/push';
import { createLogger } from '@/lib/logger';
import type { JobActivityProps } from '@/widgets/types';

import type { JobActivityFactory, JobActivityHandle } from './bridge';

const log = createLogger('widgets.live.android');

const STAGE: Record<JobActivityProps['status'], JobLiveUpdate['stage']> = { in_progress: 0, ready: 1, delivered: 2, cancelled: 2 };

function toUpdate(props: JobActivityProps, ongoing: boolean): JobLiveUpdate {
  const vehicle = props.services || props.vehicle;
  return {
    title: [props.plate, props.customer].filter(Boolean).join(' · '),
    text: [props.labels.hint, vehicle].filter(Boolean).join(' · '),
    subText: props.org,
    stage: STAGE[props.status],
    chipText: props.labels.status,
    startedAt: props.startedAt,
    url: `otopoly://jobs/${props.jobId}`,
    ongoing,
    channelName: props.labels.channel,
  };
}

/** Android Live Update for one job; the job id doubles as the activity id. */
function handle(jobId: string): JobActivityHandle {
  const native = LiveUpdates!;
  return {
    getId: () => jobId,
    async update(props) {
      if (!native.post(jobId, toUpdate(props, true))) throw new Error('Notifications are disabled');
    },
    async end(dismissal = 'default', props) {
      // 'default' keeps the final state visible (dismissible, auto-removed), like ActivityKit's default policy.
      if (dismissal === 'default' && props) native.post(jobId, toUpdate(props, false));
      else native.end(jobId);
    },
  };
}

/** Same surface as expo-widgets' LiveActivityFactory, so the bridge treats both platforms alike. */
export function androidJobActivityFactory(): JobActivityFactory | null {
  if (!LiveUpdates) return null;
  const native = LiveUpdates;
  return {
    getInstances: () => native.activeJobIds().map(handle),
    start(props) {
      if (!native.post(props.jobId, toUpdate(props, true))) throw new Error('Notifications are disabled');
      return handle(props.jobId);
    },
  };
}

/** Asks for POST_NOTIFICATIONS (Android 13+) when needed; true when a Live Update can be shown. */
export async function ensureAndroidNotificationPermission(): Promise<boolean> {
  if (!LiveUpdates) return false;
  if (LiveUpdates.areNotificationsEnabled()) return true;
  const N = notificationsModule();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (!current.granted && current.canAskAgain) await N.requestPermissionsAsync();
  } catch (error) {
    log.warn('Notification permission request failed', error);
  }
  return LiveUpdates.areNotificationsEnabled();
}
