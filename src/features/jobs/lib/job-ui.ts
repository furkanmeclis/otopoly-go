/** Ported from web `features/jobs/lib/job-ui.ts` — same rules for board columns, staleness and carry-over. */
import type { Job, JobStatus, PaymentStatus } from '@/features/jobs/services/jobs.service';
import type { Tone } from '@/components/ui';

export const BOARD_STATUSES = ['in_progress', 'ready', 'delivered'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** An in-progress job older than this is flagged as waiting too long. */
export const STALE_AFTER_MINUTES = 120;

const pad = (n: number) => String(n).padStart(2, '0');
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const localDateOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export function shiftDate(day: string, delta: number) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d + delta, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function calendarDaysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function statusTone(status: JobStatus): Tone {
  switch (status) {
    case 'in_progress':
      return 'warning';
    case 'ready':
      return 'info';
    case 'delivered':
      return 'success';
    case 'cancelled':
    case 'voided':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const paymentTone = (status: PaymentStatus): Tone => (status === 'paid' ? 'success' : 'warning');

export const minutesSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));

/** Day of work for an unfinished job opened on an earlier day (2 = second day), else null. */
export function carryOverDay(job: Job, today = localToday()): number | null {
  if (job.status !== 'in_progress' && job.status !== 'ready') return null;
  const days = calendarDaysBetween(localDateOf(job.started_at), today);
  return days > 0 ? days + 1 : null;
}

export function isStale(job: Job, now: number) {
  return job.status === 'in_progress' && carryOverDay(job) === null && minutesSince(job.started_at, now) >= STALE_AFTER_MINUTES;
}

export function sumAmounts(jobs: Job[]) {
  return jobs.reduce((total, job) => total + (Number(job.total_amount) || 0), 0);
}
