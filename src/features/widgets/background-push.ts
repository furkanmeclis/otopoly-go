/**
 * Background handler for the silent livepush messages (docs/LIVE_WIDGETS.md):
 *
 * - `widgets.refresh` (iOS + Android): rebuilds the Home / Lock Screen widget snapshot from the
 *   server's "today" figures — no network call, so it works on a locked phone within the short
 *   background window iOS grants.
 * - `live.job` (Android): re-posts the Live Update notification of a job tracked on this device.
 *
 * The task is defined at module scope (index.ts imports this file before the router), as
 * expo-task-manager requires, so it also runs when the OS starts the app in the background.
 */
import { requireOptionalNativeModule } from 'expo';
import { getLocales } from 'expo-localization';
import { AppState, Platform } from 'react-native';

import { notificationsModule } from '@/features/notifications/push';
import { createFormatters } from '@/lib/i18n/format';
import { DEFAULT_LOCALE, isSupportedLocale, translate, type AppLocale } from '@/lib/i18n/translate';
import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

import LiveUpdates from '../../../modules/otopoly-live-updates';
import { toLiveUpdate } from './android-live-updates';
import { ensureWidgetLogo, pushTodaySnapshot, widgetOrg, widgetsAvailable } from './bridge';
import { buildTodayPropsFromSnapshot } from './props';
import { liveJobAction, parseLivePush, WIDGETS_REFRESH_KIND, type LiveJobPush, type WidgetsPush } from './push-payload';

const log = createLogger('widgets.push');

export const LIVE_PUSH_TASK = 'otopoly-live-push';

/** Newest `sent_at` applied per job in this process (an older, late push must not win). */
const lastSentAt = new Map<string, number>();

async function storedLocale(): Promise<AppLocale> {
  const saved = await prefs.get<string | null>(StorageKeys.locale, null);
  if (isSupportedLocale(saved)) return saved;
  try {
    const code = getLocales()[0]?.languageCode;
    return isSupportedLocale(code) ? code : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

async function applyWidgets(push: WidgetsPush) {
  // In the foreground the in-app sync owns the widgets (same numbers, plus live updates).
  if (AppState.currentState === 'active' || !widgetsAvailable()) return false;
  const org = await widgetOrg.get();
  if (!org || org.uuid !== push.org) return false;
  const locale = await storedLocale();
  const props = buildTodayPropsFromSnapshot({
    org: org.name,
    logo: await ensureWidgetLogo(),
    snapshot: push.snapshot,
    tr: (key, params) => translate(locale, key, params),
    fmt: createFormatters(locale),
  });
  pushTodaySnapshot(props);
  log.info('Widgets refreshed from push', { queue: props.queue.length });
  return true;
}

async function applyLiveJob(push: LiveJobPush) {
  if (Platform.OS !== 'android' || !LiveUpdates) return false;
  const org = await widgetOrg.get();
  const action = liveJobAction(push, { activeOrg: org?.uuid ?? null, trackedJobIds: LiveUpdates.activeJobIds(), lastSentAt: lastSentAt.get(push.job) });
  if (action === 'ignore') return false;
  if (push.sentAt) lastSentAt.set(push.job, push.sentAt);
  if (action === 'end') LiveUpdates.end(push.job);
  else LiveUpdates.post(push.job, toLiveUpdate(push.props, action === 'post'));
  log.info('Live Update applied from push', { jobId: push.job, action });
  return true;
}

/** Applies one livepush message; true when something changed. Never throws. */
export async function handleLivePush(raw: unknown): Promise<boolean> {
  const push = parseLivePush(raw);
  if (!push) return false;
  try {
    return push.kind === WIDGETS_REFRESH_KIND ? await applyWidgets(push) : await applyLiveJob(push);
  } catch (error) {
    log.warn('Live push failed', error);
    return false;
  }
}

let registered = false;

/** Defines and registers the background notification task (no-op in Expo Go, on web and twice). */
export function registerLivePushTask() {
  if (registered || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  registered = true;
  const N = notificationsModule();
  if (!N || !requireOptionalNativeModule('ExpoTaskManager')) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, loaded only where it exists
    const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
    TaskManager.defineTask<Record<string, unknown>>(LIVE_PUSH_TASK, async ({ data, error }) => {
      if (error) return N.BackgroundNotificationTaskResult.Failed;
      const changed = await handleLivePush(data);
      return changed ? N.BackgroundNotificationTaskResult.NewData : N.BackgroundNotificationTaskResult.NoData;
    });
    N.registerTaskAsync(LIVE_PUSH_TASK).catch((e: unknown) => log.warn('Background push task not registered', e));
  } catch (error) {
    log.warn('Background push task setup failed', error);
  }
}

registerLivePushTask();
