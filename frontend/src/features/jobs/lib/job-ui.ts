import type {
  Job,
  JobStatus,
  PaymentStatus,
} from "@/features/jobs/services/jobs.service";
import { foldSearch } from "@/lib/utils/search";

export { localToday, shiftDate } from "@/lib/utils/local-date";

/** Board columns, in workflow order. */
export const BOARD_STATUSES = ["in_progress", "ready", "delivered"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** An in-progress job older than this is flagged as waiting too long. */
export const STALE_AFTER_MINUTES = 120;

export function statusTone(status: JobStatus) {
  switch (status) {
    case "in_progress":
      return "warning" as const;
    case "ready":
      return "default" as const;
    case "delivered":
      return "success" as const;
    case "cancelled":
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function paymentTone(status: PaymentStatus) {
  return status === "paid" ? ("success" as const) : ("warning" as const);
}

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export function isStale(job: Job, now: number): boolean {
  return (
    job.status === "in_progress" &&
    minutesSince(job.started_at, now) >= STALE_AFTER_MINUTES
  );
}

export function initials(name?: string | null): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("tr-TR"))
    .join("");
}

function normalize(value: string): string {
  return foldSearch(value).replace(/\s+/g, "");
}

/** Case/space-insensitive match on plate, customer, phone and assignee. */
export function matchesJob(job: Job, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return [
    job.plate,
    job.customer_name,
    job.customer_phone,
    job.assignee_name ?? "",
    job.vehicle_label,
  ].some((field) => normalize(field ?? "").includes(q));
}

export function sumAmounts(jobs: Job[]): number {
  return jobs.reduce(
    (total, job) => total + (Number(job.total_amount) || 0),
    0,
  );
}
