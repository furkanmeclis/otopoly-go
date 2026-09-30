/**
 * Props for the iOS widgets and the job Live Activity.
 *
 * Widget code runs in an isolated runtime (no i18n, no formatters, no app state), so the app sends
 * everything display-ready: translated labels, formatted money, epoch-ms timestamps.
 * Bump `v` when the shape changes so stale snapshots can be recognised.
 */

export type WidgetState = 'ok' | 'signedOut' | 'noAccess';

export type WidgetQueueItem = {
  id: string;
  plate: string;
  name: string;
  vehicle: string;
  status: 'in_progress' | 'ready';
  /** Epoch ms the job started; drives the live elapsed timer. */
  startedAt: number;
  stale: boolean;
};

export type TodayWidgetProps = {
  v: 1;
  state: WidgetState;
  org: string;
  /** file:// URI of the brand tile in the shared app-group folder, or '' when unavailable. */
  logo: string;
  updatedAt: number;
  showMoney: boolean;
  stats: {
    inProgress: number;
    ready: number;
    delivered: number;
    stale: number;
    collected: string;
  };
  queue: WidgetQueueItem[];
  labels: {
    inProgress: string;
    ready: string;
    delivered: string;
    collected: string;
    queue: string;
    queueEmpty: string;
    more: string;
    signedOut: string;
    noAccess: string;
    updated: string;
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
  };
};
