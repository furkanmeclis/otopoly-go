import type { LeadStatus, LeadTemperature } from "@/features/leads/types";

export function leadStatusTone(status: LeadStatus) {
  switch (status) {
    case "new":
      return "default" as const;
    case "contacted":
      return "warning" as const;
    case "quoted":
      return "warning" as const;
    case "won":
      return "success" as const;
    case "lost":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

/** Tailwind classes for the temperature pill / toggle. */
export const TEMPERATURE_CLASSES: Record<LeadTemperature, string> = {
  cold: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  hot: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "quoted"];

/** Next step in the happy path (used by the one-click "advance" action). */
export function nextLeadStatus(status: LeadStatus): LeadStatus | null {
  switch (status) {
    case "new":
      return "contacted";
    case "contacted":
      return "quoted";
    case "quoted":
      return "won";
    default:
      return null;
  }
}
