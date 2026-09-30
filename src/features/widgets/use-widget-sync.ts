import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { localToday } from '@/features/jobs/lib/job-ui';
import { useJobs, useJobsSummary } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

import { endAllJobActivities, endJobActivity, ensureWidgetLogo, pushTodaySnapshot, runningJobActivities, updateJobActivity, widgetsAvailable } from './bridge';
import { buildJobActivityProps, buildTodayProps } from './props';

const log = createLogger('widgets.sync');

/**
 * Keeps the Home Screen / Lock Screen widgets and running job Live Activities in step with the app.
 * Mounted once inside the signed-in shell; a no-op where widgets are unavailable (Expo Go, Android).
 * Uses the same queries as the dashboard, so it adds no extra requests while the dashboard is open.
 */
export function useWidgetSync() {
  const available = widgetsAvailable();
  const { can, organization } = useAuth();
  const { t: tr, fmt, locale } = useLocale();
  const canJobs = can(P.jobsRead);
  const today = localToday();
  const jobs = useJobs({ limit: 100, offset: 0, sort: '-started_at', date_from: today, date_to: today, include_open: 'true' }, available && canJobs);
  const summary = useJobsSummary(today, available && canJobs);
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
      void endAllJobActivities();
    }
    orgRef.current = orgId;
  }, [available, orgId]);

  useEffect(() => {
    if (!available) return;
    if (!canJobs) {
      pushTodaySnapshot(buildTodayProps({ state: 'noAccess', org: orgName, logo, today, jobs: [], tr, fmt }));
      return;
    }
    const list = jobs.data?.items;
    if (!list) return;
    pushTodaySnapshot(buildTodayProps({ state: 'ok', org: orgName, logo, today, jobs: list, summary: summary.data, tr, fmt }));

    let cancelled = false;
    void (async () => {
      const running = await runningJobActivities();
      for (const [jobId, activity] of running) {
        if (cancelled) return;
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
  }, [available, canJobs, jobs.data, summary.data, logo, orgName, today, tr, fmt, locale]);
}

/** Render-less mount point for the hook. */
export function WidgetSync() {
  useWidgetSync();
  return null;
}
