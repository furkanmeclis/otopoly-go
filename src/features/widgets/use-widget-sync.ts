import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { localToday } from '@/features/jobs/lib/job-ui';
import { qk, useJobs } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

import {
  activityPush,
  endAllJobActivities,
  endJobActivity,
  ensureWidgetLogo,
  pushTodaySnapshot,
  runningJobActivities,
  updateJobActivity,
  widgetDevice,
  widgetOrg,
  widgetsAvailable,
} from './bridge';
import { buildJobActivityProps, buildTodayProps } from './props';
import { parseWidgetSnapshot } from './push-payload';
import { liveActivitiesService } from './services/live-activities.service';

const log = createLogger('widgets.sync');

/**
 * Keeps the Home Screen / Lock Screen widgets and running job Live Activities in step with the app.
 * Mounted once inside the signed-in shell; a no-op where widgets are unavailable (Expo Go, web).
 * Counts and queue come from the same jobs query as the dashboard (no extra request while it is open);
 * money, alerts and agenda from the server snapshot (`GET …/widget-snapshot`, the same permission-
 * filtered data a background push carries), refetched with the jobs list and at most once a minute.
 */
export function useWidgetSync() {
  const available = widgetsAvailable();
  const { can, organization } = useAuth();
  const { t: tr, fmt, locale } = useLocale();
  const canJobs = can(P.jobsRead);
  const today = localToday();
  const jobs = useJobs({ limit: 100, offset: 0, sort: '-started_at', date_from: today, date_to: today, include_open: 'true' }, available && canJobs);
  const canFinance = can(P.financeRead);
  const snapshotQuery = useQuery({
    queryKey: [...qk.jobs, 'widget-snapshot', organization?.uuid ?? ''],
    queryFn: () => liveActivitiesService.widgetSnapshot(),
    enabled: available && canJobs,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const snapshot = useMemo(() => (snapshotQuery.data ? parseWidgetSnapshot(snapshotQuery.data) : null), [snapshotQuery.data]);
  const [logo, setLogo] = useState('');
  const activitySnapshots = useRef(new Map<string, string>());
  const orgRef = useRef<string | null>(null);
  const orgName = organization?.name ?? '';
  const orgId = organization?.uuid ?? null;

  useEffect(() => {
    if (!available) return;
    let alive = true;
    ensureWidgetLogo().then((uri) => alive && setLogo(uri));
    return () => {
      alive = false;
    };
  }, [available]);

  // Activities belong to one organization; switching org must not leave another business's car on the Lock Screen.
  useEffect(() => {
    if (!available || !orgId) return;
    if (orgRef.current && orgRef.current !== orgId) {
      log.info('Organization changed, ending Live Activities');
      activitySnapshots.current.clear();
      // The token already carries the new organization: old rows expire on the server.
      void endAllJobActivities({ server: false });
    }
    orgRef.current = orgId;
  }, [available, orgId]);

  // iOS 17.2+: the push-to-start token lets the server start a job activity remotely; it is stored
  // with the device link (not used for automatic starts yet, see docs/LIVE_WIDGETS.md).
  useEffect(() => {
    if (!available || Platform.OS !== 'ios') return;
    let sub: { remove(): void } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- native widgets module, loaded only when available
      const widgets = require('expo-widgets') as typeof import('expo-widgets');
      sub = widgets.addPushToStartTokenListener((event) => {
        widgetDevice.setPushToStartToken(event.activityPushToStartToken);
        if (orgRef.current) void widgetDevice.sync({ orgUuid: orgRef.current, orgName });
      });
    } catch (error) {
      log.warn('Push-to-start token listener failed', error);
    }
    return () => sub?.remove();
  }, [available, orgName]);

  // Background refresh pushes: tell the backend which organization this device's widgets show.
  useEffect(() => {
    if (!available || !canJobs || !orgId) return;
    void widgetOrg.set({ uuid: orgId, name: orgName });
    void widgetDevice.sync({ orgUuid: orgId, orgName });
  }, [available, canJobs, orgId, orgName, jobs.data]);

  useEffect(() => {
    if (!available) return;
    if (!canJobs) {
      pushTodaySnapshot(buildTodayProps({ state: 'noAccess', org: orgName, logo, today, jobs: [], tr, fmt }));
      return;
    }
    const list = jobs.data?.items;
    if (!list) return;
    pushTodaySnapshot(buildTodayProps({ state: 'ok', org: orgName, logo, today, jobs: list, snapshot, canFinance, tr, fmt }));

    let cancelled = false;
    void (async () => {
      const running = await runningJobActivities();
      for (const [jobId, activity] of running) {
        if (cancelled) return;
        // After a relaunch: re-register for server updates and follow token rotations (deduped).
        void activityPush.track(jobId, activity);
        const job = list.find((j) => j.uuid === jobId);
        if (!job) continue;
        if (job.status === 'voided') {
          await endJobActivity(jobId);
          continue;
        }
        const props = buildJobActivityProps(job, orgName, tr);
        if (!props) continue;
        const key = JSON.stringify(props);
        if (activitySnapshots.current.get(jobId) === key) continue;
        activitySnapshots.current.set(jobId, key);
        await updateJobActivity(activity, props);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, canJobs, canFinance, jobs.data, snapshot, logo, orgName, today, tr, fmt, locale]);
}

/** Render-less mount point for the hook. */
export function WidgetSync() {
  useWidgetSync();
  return null;
}
