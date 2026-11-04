/**
 * Props for the Home Screen / Lock Screen widgets (iOS + Android) and the job Live Activity.
 *
 * Widget code runs in an isolated runtime (no i18n, no formatters, no app state), so the app sends
 * everything display-ready: translated labels, formatted money, epoch-ms timestamps, deep links.
 * Every widget gets the same props (one snapshot, many views). Bump `v` when the shape changes so
 * stale snapshots can be recognised (widgets show "open Otopoly" for an unknown version).
 */

export type WidgetState = 'ok' | 'signedOut' | 'noAccess';

/** A section the member may see (`ok`), may not see (`locked`) or that is not loaded yet (`loading`). */
export type WidgetSectionState = 'ok' | 'locked' | 'loading';

export type WidgetQueueItem = {
  id: string;
  plate: string;
  name: string;
  vehicle: string;
  status: 'in_progress' | 'ready';
  /** Epoch ms the job started; drives the live elapsed timer. */
  startedAt: number;
  /** Start time pre-formatted for Android, which has no live timer text ("09:42"). */
  since: string;
  stale: boolean;
  url: string;
};

export type WidgetAccount = { name: string; balance: string; kind: 'cash' | 'bank' | 'other' };

/** One day of the 7-day collections chart. */
export type WidgetBar = {
  /** Weekday initial ("P", "S" …). */
  label: string;
  /** Compact money ("₺12,5 B"). */
  value: string;
  /** 0…1 of the week's best day; drives the bar height. */
  ratio: number;
  today: boolean;
};

export type WidgetAlertKey = 'unpaid' | 'stock' | 'reviews' | 'renewals';

export type WidgetAlertItem = {
  key: WidgetAlertKey;
  count: number;
  label: string;
  /** SF Symbol (iOS). */
  symbol: string;
  url: string;
};

export type WidgetAgendaItem = {
  id: string;
  kind: 'event' | 'todo';
  title: string;
  /** "14:30" or the all-day label. */
  time: string;
  /** Epoch ms; 0 for all-day / untimed items. */
  startsAt: number;
  url: string;
};

export type TodayWidgetProps = {
  v: 2;
  state: WidgetState;
  org: string;
  /** file:// URI of the brand tile in the shared app-group folder, or '' when unavailable. */
  logo: string;
  updatedAt: number;
  /** `updatedAt` pre-formatted ("14:05"); Android cannot format dates inside the widget. */
  updatedTime: string;
  /** "14:05 itibarıyla" / "as of 14:05". */
  asOf: string;
  /** Money may be shown (tenant.finance.read and the figures are loaded). */
  showMoney: boolean;
  stats: {
    inProgress: number;
    ready: number;
    delivered: number;
    stale: number;
    /** in progress + ready. */
    open: number;
    /** The day's collections ("tahsilat"), formatted; '' without finance read. */
    collected: string;
    collectedCompact: string;
    /** Jobs revenue ("işlerden ciro"), formatted; '' without finance read. */
    jobsRevenue: string;
  };
  queue: WidgetQueueItem[];
  /** Open jobs that did not fit into `queue`. */
  more: number;
  money: {
    state: WidgetSectionState;
    cash: string;
    card: string;
    other: string;
    moneyIn: string;
    moneyOut: string;
    net: string;
    netNegative: boolean;
    accounts: WidgetAccount[];
    week: WidgetBar[];
    weekTotal: string;
  };
  alerts: {
    state: WidgetSectionState;
    total: number;
    /** Only alerts with a count > 0, most urgent first. */
    items: WidgetAlertItem[];
  };
  agenda: {
    state: WidgetSectionState;
    items: WidgetAgendaItem[];
  };
  links: {
    home: string;
    newJob: string;
    ready: string;
    finance: string;
    accounts: string;
    calendar: string;
  };
  labels: {
    inProgress: string;
    ready: string;
    delivered: string;
    open: string;
    collected: string;
    jobsRevenue: string;
    queue: string;
    queueEmpty: string;
    readyCars: string;
    readyEmpty: string;
    more: string;
    signedOut: string;
    noAccess: string;
    openApp: string;
    updated: string;
    started: string;
    loading: string;
    cashTitle: string;
    cash: string;
    card: string;
    otherMethods: string;
    moneyIn: string;
    moneyOut: string;
    net: string;
    balances: string;
    moneyLocked: string;
    week: string;
    weekTotal: string;
    agenda: string;
    agendaEmpty: string;
    agendaLocked: string;
    alerts: string;
    alertsEmpty: string;
    newJob: string;
  };
};

export type JobActivityProps = {
  v: 1;
  jobId: string;
  plate: string;
  customer: string;
  vehicle: string;
  services: string;
  status: 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  startedAt: number;
  /** Epoch ms the job became ready/delivered; 0 while it is still being worked on. */
  finishedAt: number;
  org: string;
  labels: {
    status: string;
    elapsed: string;
    hint: string;
    /** Android notification channel name for Live Updates. */
    channel: string;
  };
};
