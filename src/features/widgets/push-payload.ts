/**
 * Data-only pushes from otopoly-go modules/livepush (docs/LIVE_WIDGETS.md). Pure parsing and decisions,
 * no React Native imports, so the smoke tests can run them in Node.
 *
 * - `live.job`        Android: the new state of a job tracked on this device (re-posts the Live Update).
 *                     iOS never gets it: ActivityKit pushes go to the Live Activity directly over APNs.
 * - `widgets.refresh` both: the organization's "today" snapshot for the Home / Lock Screen widgets.
 */
import type { JobActivityProps } from '@/widgets/types';

export const LIVE_JOB_KIND = 'live.job';
export const WIDGETS_REFRESH_KIND = 'widgets.refresh';
export const SILENT_PUSH_KINDS: readonly string[] = [LIVE_JOB_KIND, WIDGETS_REFRESH_KIND];

/** Money of the day (only for members with tenant.finance.read); decimal strings. */
export type WidgetSnapshotMoney = {
  cur: string;
  /** The day's collections ("tahsilat": every posted income of the Istanbul day, no transfers / voids). */
  collected: string;
  /** Jobs revenue ("işlerden ciro"): paid jobs, cari closes included — not money in. */
  jobs: string;
  cash: string;
  card: string;
  transfer: string;
  other: string;
  expense: string;
  net: string;
  /** Collections per day, 7 days, oldest first, ending on `date`. */
  week: string[];
  accounts: { n: string; t: string; b: string }[];
};

/** A missing count is a module the member may not read. */
export type WidgetSnapshotAlerts = { stock?: number; reviews?: number; renewals?: number; unpaid?: number };

export type WidgetSnapshotAgendaItem = { k: 'event' | 'todo'; id: string; t: string; at: string };

/**
 * The `widgets.refresh` snapshot (= GET /v1/tenant/live-activities/widget-snapshot). Built per recipient:
 * `money` / `alerts.*` / `agenda` are absent when the member may not see them.
 */
export type WidgetSnapshot = {
  v: 1;
  date: string;
  at: number;
  counts: { in_progress: number; ready: number; delivered: number };
  /** Legacy copy of money.collected ('' without finance read). */
  paid_total: string;
  queue: { id: string; plate: string; name: string; vehicle: string; status: 'in_progress' | 'ready'; started_at: string }[];
  more: number;
  money?: WidgetSnapshotMoney;
  alerts?: WidgetSnapshotAlerts;
  agenda?: { items: WidgetSnapshotAgendaItem[] };
};

export type LiveJobPush = {
  kind: typeof LIVE_JOB_KIND;
  org: string;
  job: string;
  /** '' = still running, 'default' = finished (stays a while), 'immediate' = remove now (voided). */
  end: '' | 'default' | 'immediate';
  props: JobActivityProps;
  sentAt: number;
};

export type WidgetsPush = { kind: typeof WIDGETS_REFRESH_KIND; org: string; snapshot: WidgetSnapshot };

export type LivePush = LiveJobPush | WidgetsPush;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The push data from whatever shape it arrives in: the background task gets `{ data: { dataString } }`
 * (JSON of the Expo `data`; Android also `data.body`), a foreground notification has `content.data`.
 */
export function extractPushData(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  if (isStr(raw.kind)) return raw;
  const inner = isObj(raw.data) ? raw.data : null;
  if (inner) {
    if (isStr(inner.kind)) return inner;
    for (const key of ['dataString', 'body'] as const) {
      const v = inner[key];
      if (isObj(v) && isStr(v.kind)) return v;
      if (isStr(v)) {
        try {
          const parsed = JSON.parse(v);
          if (isObj(parsed)) return parsed;
        } catch {
          // not JSON: not ours
        }
      }
    }
  }
  const content = isObj(raw.request) && isObj(raw.request.content) ? raw.request.content : null;
  if (content && isObj(content.data)) return extractPushData(content.data);
  return null;
}

function parseProps(v: unknown): JobActivityProps | null {
  if (!isObj(v) || v.v !== 1 || !isStr(v.jobId) || !isStr(v.plate) || !isStr(v.status) || !isNum(v.startedAt)) return null;
  if (!['in_progress', 'ready', 'delivered', 'cancelled'].includes(v.status)) return null;
  const labels = isObj(v.labels) ? v.labels : {};
  const s = (x: unknown) => (isStr(x) ? x : '');
  return {
    v: 1,
    jobId: v.jobId,
    plate: v.plate,
    customer: s(v.customer),
    vehicle: s(v.vehicle),
    services: s(v.services),
    status: v.status as JobActivityProps['status'],
    startedAt: v.startedAt,
    finishedAt: isNum(v.finishedAt) ? v.finishedAt : 0,
    org: s(v.org),
    labels: { status: s(labels.status), elapsed: s(labels.elapsed), hint: s(labels.hint), channel: s(labels.channel) },
  };
}

/** A snapshot from a push or from GET /live-activities/widget-snapshot; null when malformed. */
export function parseWidgetSnapshot(v: unknown): WidgetSnapshot | null {
  if (!isObj(v) || v.v !== 1 || !isObj(v.counts) || !Array.isArray(v.queue)) return null;
  const c = v.counts;
  if (!isNum(c.in_progress) || !isNum(c.ready) || !isNum(c.delivered)) return null;
  const queue: WidgetSnapshot['queue'] = [];
  for (const q of v.queue) {
    if (!isObj(q) || !isStr(q.id) || (q.status !== 'in_progress' && q.status !== 'ready')) continue;
    queue.push({
      id: q.id,
      plate: isStr(q.plate) ? q.plate : '',
      name: isStr(q.name) ? q.name : '',
      vehicle: isStr(q.vehicle) ? q.vehicle : '',
      status: q.status,
      started_at: isStr(q.started_at) ? q.started_at : '',
    });
  }
  const out: WidgetSnapshot = {
    v: 1,
    date: isStr(v.date) ? v.date : '',
    at: isNum(v.at) ? v.at : 0,
    counts: { in_progress: c.in_progress, ready: c.ready, delivered: c.delivered },
    paid_total: isStr(v.paid_total) ? v.paid_total : '',
    queue,
    more: isNum(v.more) ? v.more : 0,
  };
  const money = parseMoney(v.money);
  if (money) out.money = money;
  if (isObj(v.alerts)) {
    const a: WidgetSnapshotAlerts = {};
    for (const key of ['stock', 'reviews', 'renewals', 'unpaid'] as const) {
      const n = v.alerts[key];
      if (isNum(n) && n >= 0) a[key] = Math.floor(n);
    }
    out.alerts = a;
  }
  if (isObj(v.agenda) && Array.isArray(v.agenda.items)) {
    const items: WidgetSnapshotAgendaItem[] = [];
    for (const it of v.agenda.items) {
      if (!isObj(it) || !isStr(it.id) || (it.k !== 'event' && it.k !== 'todo')) continue;
      items.push({ k: it.k, id: it.id, t: isStr(it.t) ? it.t : '', at: isStr(it.at) ? it.at : '' });
    }
    out.agenda = { items };
  }
  return out;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const dec = (x: unknown) => (isStr(x) && DECIMAL_RE.test(x) ? x : '0.00');

function parseMoney(v: unknown): WidgetSnapshotMoney | undefined {
  if (!isObj(v) || !isStr(v.collected) || !DECIMAL_RE.test(v.collected)) return undefined;
  const accounts: WidgetSnapshotMoney['accounts'] = [];
  if (Array.isArray(v.accounts)) {
    for (const a of v.accounts) if (isObj(a) && isStr(a.n)) accounts.push({ n: a.n, t: isStr(a.t) ? a.t : '', b: dec(a.b) });
  }
  return {
    cur: isStr(v.cur) && /^[A-Z]{3}$/.test(v.cur) ? v.cur : 'TRY',
    collected: v.collected,
    jobs: dec(v.jobs),
    cash: dec(v.cash),
    card: dec(v.card),
    transfer: dec(v.transfer),
    other: dec(v.other),
    expense: dec(v.expense),
    net: dec(v.net),
    week: Array.isArray(v.week) ? v.week.slice(-7).map(dec) : [],
    accounts: accounts.slice(0, 4),
  };
}

/** The data of a widget push must stay under this (APNs / FCM allow 4 KB per message with the envelope). */
export const WIDGET_PUSH_DATA_BUDGET = 3000;

/** A livepush data message, or null for anything else (regular notifications, malformed data). */
export function parseLivePush(raw: unknown): LivePush | null {
  const d = extractPushData(raw);
  if (!d || !isStr(d.org)) return null;
  if (d.kind === LIVE_JOB_KIND) {
    const props = parseProps(d.props);
    if (!props || !isStr(d.job) || props.jobId !== d.job) return null;
    const end = d.end === 'default' || d.end === 'immediate' ? d.end : '';
    return { kind: LIVE_JOB_KIND, org: d.org, job: d.job, end, props, sentAt: isNum(d.sent_at) ? d.sent_at : 0 };
  }
  if (d.kind === WIDGETS_REFRESH_KIND) {
    const snapshot = parseWidgetSnapshot(d.snapshot);
    return snapshot ? { kind: WIDGETS_REFRESH_KIND, org: d.org, snapshot } : null;
  }
  return null;
}

/** Whether a received notification is one of the silent livepush messages (never shown as a banner). */
export function isSilentPush(raw: unknown) {
  const d = extractPushData(raw);
  return Boolean(d && isStr(d.kind) && SILENT_PUSH_KINDS.includes(d.kind));
}

export type LiveJobAction = 'post' | 'final' | 'end' | 'ignore';

/**
 * What an Android `live.job` push does to the Live Update: only jobs still tracked on this device are
 * touched (a stopped tracking must not come back), and an older push never overwrites a newer one.
 */
export function liveJobAction(push: LiveJobPush, ctx: { activeOrg: string | null; trackedJobIds: readonly string[]; lastSentAt?: number }): LiveJobAction {
  if (!ctx.activeOrg || push.org !== ctx.activeOrg) return 'ignore';
  if (!ctx.trackedJobIds.includes(push.job)) return 'ignore';
  if (ctx.lastSentAt && push.sentAt && push.sentAt < ctx.lastSentAt) return 'ignore';
  if (push.end === 'immediate') return 'end';
  if (push.end === 'default') return 'final';
  return 'post';
}
