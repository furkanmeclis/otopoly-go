import type { Job, JobsSummary } from '@/features/jobs/services/jobs.service';
import { businessDayOf } from '@/lib/business-date';
import { isStale, shiftDate } from '@/features/jobs/lib/job-ui';
import type { Formatters } from '@/lib/i18n/format';
import type { TranslateParams } from '@/lib/i18n/translate';
import type { JobActivityProps, TodayWidgetProps, WidgetQueueItem, WidgetState } from '@/widgets/types';

import type { WidgetSnapshot } from './push-payload';

type Translate = (key: string, params?: TranslateParams) => string;

const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() || 0 : 0);

export function todayLabels(tr: Translate): TodayWidgetProps['labels'] {
  return {
    inProgress: tr('mobile.widgets.in_progress'),
    ready: tr('mobile.widgets.ready'),
    delivered: tr('mobile.widgets.delivered'),
    collected: tr('mobile.widgets.collected'),
    queue: tr('mobile.widgets.queue'),
    queueEmpty: tr('mobile.widgets.queue_empty'),
    more: tr('mobile.widgets.more'),
    signedOut: tr('mobile.widgets.signed_out'),
    noAccess: tr('mobile.widgets.no_access'),
    updated: tr('mobile.widgets.updated'),
    started: tr('mobile.widgets.started'),
  };
}

/** Same numbers as the dashboard "Today" tiles, so the widget never disagrees with the app. */
export function buildTodayProps(input: {
  state: WidgetState;
  org: string;
  logo: string;
  today: string;
  jobs: Job[];
  summary?: JobsSummary;
  tr: Translate;
  fmt: Formatters;
}): TodayWidgetProps {
  const { jobs, today, fmt } = input;
  const now = Date.now();
  const inProgress = jobs.filter((j) => j.status === 'in_progress');
  const ready = jobs.filter((j) => j.status === 'ready');
  const delivered = jobs.filter((j) => j.status === 'delivered' && !!j.delivered_at && businessDayOf(j.delivered_at) >= shiftDate(today, -1));
  const queue = [...ready, ...inProgress].map((j) => ({
    id: j.uuid,
    plate: j.plate,
    name: j.customer_name,
    vehicle: j.vehicle_label,
    status: j.status as 'in_progress' | 'ready',
    startedAt: ms(j.started_at),
    since: j.started_at ? fmt.time(j.started_at) : '',
    stale: isStale(j, now),
  }));
  return {
    v: 1,
    state: input.state,
    org: input.org,
    logo: input.logo,
    updatedAt: now,
    updatedTime: fmt.time(new Date(now)),
    showMoney: input.state === 'ok' && Boolean(input.summary),
    stats: {
      inProgress: inProgress.length,
      ready: ready.length,
      delivered: delivered.length,
      stale: queue.filter((q) => q.stale).length,
      collected: input.summary ? fmt.money(input.summary.paid_total) : '',
    },
    queue: queue.slice(0, 12),
    labels: todayLabels(input.tr),
  };
}

/**
 * Widget props from a `widgets.refresh` background push (the app is not running, so there is no
 * React Query data). Same tiles and queue as buildTodayProps; the server already picked today's jobs.
 */
export function buildTodayPropsFromSnapshot(input: {
  org: string;
  logo: string;
  snapshot: WidgetSnapshot;
  tr: Translate;
  fmt: Formatters;
  now?: number;
}): TodayWidgetProps {
  const { snapshot, fmt } = input;
  const now = input.now ?? Date.now();
  const queue: WidgetQueueItem[] = snapshot.queue.map((q) => {
    const job = { status: q.status, started_at: q.started_at } as Job;
    return {
      id: q.id,
      plate: q.plate,
      name: q.name,
      vehicle: q.vehicle,
      status: q.status,
      startedAt: ms(q.started_at),
      since: q.started_at ? fmt.time(q.started_at) : '',
      stale: Boolean(q.started_at) && isStale(job, now),
    };
  });
  return {
    v: 1,
    state: 'ok',
    org: input.org,
    logo: input.logo,
    updatedAt: now,
    updatedTime: fmt.time(new Date(now)),
    showMoney: true,
    stats: {
      inProgress: snapshot.counts.in_progress,
      ready: snapshot.counts.ready,
      delivered: snapshot.counts.delivered,
      stale: queue.filter((q) => q.stale).length,
      collected: fmt.money(snapshot.paid_total),
    },
    queue: queue.slice(0, 12),
    labels: todayLabels(input.tr),
  };
}

const HINT: Record<JobActivityProps['status'], string> = {
  in_progress: 'mobile.live.hint_in_progress',
  ready: 'mobile.live.hint_ready',
  delivered: 'mobile.live.hint_delivered',
  cancelled: 'mobile.live.hint_cancelled',
};

/** Live Activity content for a job; null for states an activity cannot represent. */
export function buildJobActivityProps(job: Job & { lines?: { name: string }[] }, org: string, tr: Translate): JobActivityProps | null {
  const status = job.status as JobActivityProps['status'];
  if (!(status in HINT)) return null;
  const finishedAt = status === 'in_progress' ? 0 : ms(job.completed_at) || ms(job.delivered_at) || ms(job.updated_at) || Date.now();
  return {
    v: 1,
    jobId: job.uuid,
    plate: job.plate,
    customer: job.customer_name,
    vehicle: job.vehicle_label,
    services: (job.services?.length ? job.services : (job.lines ?? [])).map((s) => s.name).join(', '),
    status,
    startedAt: ms(job.started_at) || Date.now(),
    finishedAt,
    org,
    labels: {
      status: tr(`jobs.status.${status}`),
      elapsed: tr('mobile.live.elapsed'),
      hint: tr(HINT[status]),
      channel: tr('mobile.live.channel'),
    },
  };
}
