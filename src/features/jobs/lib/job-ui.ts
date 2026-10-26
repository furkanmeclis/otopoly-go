/** Ported from web `features/jobs/lib/job-ui.ts` — same rules for board columns, staleness and carry-over. */
import type { Job, JobStatus, PaymentStatus } from '@/features/jobs/services/jobs.service';
import type { Tone } from '@/components/ui';
import { businessDayOf, businessToday, daysBetween, shiftDay } from '@/lib/business-date';

export const BOARD_STATUSES = ['in_progress', 'ready', 'delivered'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** An in-progress job older than this is flagged as waiting too long. */
export const STALE_AFTER_MINUTES = 120;

/** Today's business day (yyyy-MM-dd, Europe/Istanbul) — what the API calls "today". */
export const localToday = () => businessToday();
/** Business day (Europe/Istanbul) of an ISO timestamp. */
export const localDateOf = (iso: string) => businessDayOf(iso);
export function shiftDate(day: string, delta: number) {
  return shiftDay(day, delta);
}
const calendarDaysBetween = daysBetween;

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
  return job.status === 'in_progress' && carryOverDay(job, businessToday(now)) === null && minutesSince(job.started_at, now) >= STALE_AFTER_MINUTES;
}

export function sumAmounts(jobs: Job[]) {
  return jobs.reduce((total, job) => total + (Number(job.total_amount) || 0), 0);
}
