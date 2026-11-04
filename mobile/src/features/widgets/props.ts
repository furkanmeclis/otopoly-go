import type { Job } from '@/features/jobs/services/jobs.service';
import { businessDayOf } from '@/lib/business-date';
import { isStale, shiftDate } from '@/features/jobs/lib/job-ui';
import type { Formatters } from '@/lib/i18n/format';
import type { TranslateParams } from '@/lib/i18n/translate';
import type {
  JobActivityProps,
  TodayWidgetProps,
  WidgetAgendaItem,
  WidgetAlertItem,
  WidgetAlertKey,
  WidgetBar,
  WidgetQueueItem,
  WidgetSectionState,
  WidgetState,
} from '@/widgets/types';

import type { WidgetSnapshot } from './push-payload';

type Translate = (key: string, params?: TranslateParams) => string;

const ms = (iso?: string | null) => (iso ? new Date(iso).getTime() || 0 : 0);

/** Deep links the widgets open (`otopoly://` app routes, see src/app). */
export const WIDGET_LINKS: TodayWidgetProps['links'] = {
  home: 'otopoly://operations',
  newJob: 'otopoly://jobs/new',
  ready: 'otopoly://operations?filter=ready',
  finance: 'otopoly://finance',
  accounts: 'otopoly://finance/accounts',
  calendar: 'otopoly://calendar',
};

const ALERT_LINKS: Record<WidgetAlertKey, string> = {
  unpaid: 'otopoly://operations?filter=delivered&unpaid=1',
  stock: 'otopoly://catalog/products?stock=low_stock',
  renewals: 'otopoly://loyalty?tab=subscriptions',
  reviews: 'otopoly://reviews?filter=follow_up',
};

const ALERT_SYMBOLS: Record<WidgetAlertKey, string> = {
  unpaid: 'creditcard.trianglebadge.exclamationmark',
  stock: 'shippingbox.fill',
  renewals: 'arrow.triangle.2.circlepath',
  reviews: 'star.bubble.fill',
};

/** Most urgent first: money left on the table, then stock, renewals, reviews. */
const ALERT_ORDER: WidgetAlertKey[] = ['unpaid', 'stock', 'renewals', 'reviews'];

export function todayLabels(tr: Translate): TodayWidgetProps['labels'] {
  const k = (key: string) => tr(`mobile.widgets.${key}`);
  return {
    inProgress: k('in_progress'),
    ready: k('ready'),
    delivered: k('delivered'),
    open: k('open'),
    collected: k('collected'),
    jobsRevenue: k('jobs_revenue'),
    queue: k('queue'),
    queueEmpty: k('queue_empty'),
    readyCars: k('ready_cars'),
    readyEmpty: k('ready_empty'),
    more: k('more'),
    signedOut: k('signed_out'),
    noAccess: k('no_access'),
    openApp: k('open_app'),
    updated: k('updated'),
    started: k('started'),
    loading: k('loading'),
    cashTitle: k('cash_title'),
    cash: k('cash'),
    card: k('card'),
    otherMethods: k('other_methods'),
    moneyIn: k('money_in'),
    moneyOut: k('money_out'),
    net: k('net'),
    balances: k('balances'),
    moneyLocked: k('money_locked'),
    week: k('week'),
    weekTotal: k('week_total'),
    agenda: k('agenda'),
    agendaEmpty: k('agenda_empty'),
    agendaLocked: k('agenda_locked'),
    alerts: k('alerts'),
    alertsEmpty: k('alerts_empty'),
    newJob: k('new_job'),
  };
}

const emptyMoney = (state: WidgetSectionState): TodayWidgetProps['money'] => ({
  state,
  cash: '',
  card: '',
  other: '',
  moneyIn: '',
  moneyOut: '',
  net: '',
  netNegative: false,
  accounts: [],
  week: [],
  weekTotal: '',
});

/** Weekday of a business day (YYYY-MM-DD), 0 = Sunday, independent of the phone's zone. */
const weekday = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

type Sections = Pick<TodayWidgetProps, 'showMoney' | 'money' | 'alerts' | 'agenda'> & { collected: string; collectedCompact: string; jobsRevenue: string };

/**
 * Money, alerts and agenda from the server snapshot (permission-filtered per member). Without a snapshot
 * yet, money is `loading` for finance readers and `locked` for everyone else.
 */
function sections(snapshot: WidgetSnapshot | null | undefined, canFinance: boolean, tr: Translate, fmt: Formatters): Sections {
  const out: Sections = {
    showMoney: false,
    collected: '',
    collectedCompact: '',
    jobsRevenue: '',
    money: emptyMoney(snapshot || !canFinance ? 'locked' : 'loading'),
    alerts: { state: snapshot ? 'locked' : 'loading', total: 0, items: [] },
    agenda: { state: snapshot ? 'locked' : 'loading', items: [] },
  };
  if (!snapshot) return out;
  const m = snapshot.money;
  if (m) {
    const cur = m.cur || 'TRY';
    const other = Number(m.transfer) + Number(m.other);
    const values = m.week.map(Number);
    const best = Math.max(0, ...values);
    out.showMoney = true;
    out.collected = fmt.money(m.collected, cur);
    out.collectedCompact = fmt.moneyCompact(m.collected, cur);
    out.jobsRevenue = fmt.money(m.jobs, cur);
    out.money = {
      state: 'ok',
      cash: fmt.money(m.cash, cur),
      card: fmt.money(m.card, cur),
      other: fmt.money(other, cur),
      moneyIn: fmt.money(m.collected, cur),
      moneyOut: fmt.money(m.expense, cur),
      net: fmt.money(m.net, cur),
      netNegative: Number(m.net) < 0,
      accounts: m.accounts.map((a) => ({ name: a.n, balance: fmt.money(a.b, cur), kind: a.t === 'cash' || a.t === 'bank' ? a.t : 'other' })),
      week: values.map(
        (v, i): WidgetBar => ({
          label: tr(`mobile.widgets.wd_${weekday(shiftDate(snapshot.date, i - (values.length - 1)))}`),
          value: fmt.moneyCompact(v, cur),
          ratio: best > 0 ? Math.round((v / best) * 100) / 100 : 0,
          today: i === values.length - 1,
        }),
      ),
      weekTotal: fmt.money(
        values.reduce((s, v) => s + v, 0),
        cur,
      ),
    };
  }
  if (snapshot.alerts) {
    const a = snapshot.alerts;
    const items: WidgetAlertItem[] = [];
    for (const key of ALERT_ORDER) {
      const count = a[key];
      if (typeof count === 'number' && count > 0) items.push({ key, count, label: tr(`mobile.widgets.alert_${key}`, { count }), symbol: ALERT_SYMBOLS[key], url: ALERT_LINKS[key] });
    }
    out.alerts = { state: 'ok', total: items.reduce((s, i) => s + i.count, 0), items };
  }
  if (snapshot.agenda) {
    out.agenda = {
      state: 'ok',
      items: snapshot.agenda.items.map(
        (it): WidgetAgendaItem => ({
          id: it.id,
          kind: it.k,
          title: it.t,
          time: it.at ? fmt.time(it.at) : tr('mobile.widgets.all_day'),
          startsAt: ms(it.at),
          url: it.k === 'event' ? WIDGET_LINKS.calendar : 'otopoly://todos',
        }),
      ),
    };
  }
  return out;
}

function base(input: { state: WidgetState; org: string; logo: string; now: number; tr: Translate; fmt: Formatters }) {
  // An ISO string is shown on the Türkiye clock (fmt.time), like every other time on the widgets.
  const updatedTime = input.fmt.time(new Date(input.now).toISOString());
  return {
    v: 2 as const,
    state: input.state,
    org: input.org,
    logo: input.logo,
    updatedAt: input.now,
    updatedTime,
    asOf: input.tr('mobile.widgets.as_of', { time: updatedTime }),
    links: WIDGET_LINKS,
    labels: todayLabels(input.tr),
  };
}

const queueItem = (q: Omit<WidgetQueueItem, 'url'>): WidgetQueueItem => ({ ...q, url: `otopoly://jobs/${q.id}` });

/**
 * In-app widget props: counts and queue from the live jobs list (same numbers as the dashboard "Today"
 * tiles), money / alerts / agenda from the server snapshot (`GET …/widget-snapshot`, the same data a
 * background push carries). Money is shown only to members with finance read.
 */
export function buildTodayProps(input: {
  state: WidgetState;
  org: string;
  logo: string;
  today: string;
  jobs: Job[];
  snapshot?: WidgetSnapshot | null;
  canFinance?: boolean;
  tr: Translate;
  fmt: Formatters;
  now?: number;
}): TodayWidgetProps {
  const { jobs, today, fmt } = input;
  const now = input.now ?? Date.now();
  const ok = input.state === 'ok';
  const inProgress = jobs.filter((j) => j.status === 'in_progress');
  const ready = jobs.filter((j) => j.status === 'ready');
  const delivered = jobs.filter((j) => j.status === 'delivered' && !!j.delivered_at && businessDayOf(j.delivered_at) >= shiftDate(today, -1));
  const queue = [...ready, ...inProgress].map((j) =>
    queueItem({
      id: j.uuid,
      plate: j.plate,
      name: j.customer_name,
      vehicle: j.vehicle_label,
      status: j.status as 'in_progress' | 'ready',
      startedAt: ms(j.started_at),
      since: j.started_at ? fmt.time(j.started_at) : '',
      stale: isStale(j, now),
    }),
  );
  const s = ok ? sections(input.snapshot, Boolean(input.canFinance), input.tr, fmt) : sections(null, false, input.tr, fmt);
  return {
    ...base({ ...input, now }),
    showMoney: ok && s.showMoney,
    stats: {
      inProgress: inProgress.length,
      ready: ready.length,
      delivered: delivered.length,
      stale: queue.filter((q) => q.stale).length,
      open: inProgress.length + ready.length,
      collected: ok ? s.collected : '',
      collectedCompact: ok ? s.collectedCompact : '',
      jobsRevenue: ok ? s.jobsRevenue : '',
    },
    queue: queue.slice(0, 12),
    more: Math.max(0, queue.length - 12),
    money: ok ? s.money : emptyMoney('locked'),
    alerts: ok ? s.alerts : { state: 'locked', total: 0, items: [] },
    agenda: ok ? s.agenda : { state: 'locked', items: [] },
  };
}

/**
 * Widget props from a `widgets.refresh` background push (the app is not running, so there is no React
 * Query data). Same tiles and labels as buildTodayProps; the server already picked today's jobs and
 * left out what this member may not see.
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
    return queueItem({
      id: q.id,
      plate: q.plate,
      name: q.name,
      vehicle: q.vehicle,
      status: q.status,
      startedAt: ms(q.started_at),
      since: q.started_at ? fmt.time(q.started_at) : '',
      stale: Boolean(q.started_at) && isStale(job, now),
    });
  });
  const s = sections(snapshot, false, input.tr, fmt);
  return {
    ...base({ state: 'ok', org: input.org, logo: input.logo, now, tr: input.tr, fmt }),
    showMoney: s.showMoney,
    stats: {
      inProgress: snapshot.counts.in_progress,
      ready: snapshot.counts.ready,
      delivered: snapshot.counts.delivered,
      stale: queue.filter((q) => q.stale).length,
      open: snapshot.counts.in_progress + snapshot.counts.ready,
      collected: s.collected,
      collectedCompact: s.collectedCompact,
      jobsRevenue: s.jobsRevenue,
    },
    queue: queue.slice(0, 12),
    more: snapshot.more + Math.max(0, queue.length - 12),
    money: s.money,
    alerts: s.alerts,
    agenda: s.agenda,
  };
}

/** The signed-out card: no business data stays on the Home Screen after logout. */
export function signedOutProps(prev: TodayWidgetProps, tr: Translate, fmt: Formatters, now = Date.now()): TodayWidgetProps {
  const p = buildTodayProps({ state: 'signedOut', org: '', logo: prev.logo, today: '', jobs: [], tr, fmt, now });
  return { ...p, updatedTime: '', asOf: '' };
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
