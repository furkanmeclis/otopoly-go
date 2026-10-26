import type {
  ReviewFollowUpStatus,
  ReviewStatus,
} from "@/features/reviews/types";

export function reviewStatusTone(status: ReviewStatus) {
  switch (status) {
    case "answered":
      return "success" as const;
    case "sent":
    case "opened":
    case "scheduled":
      return "warning" as const;
    case "failed":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function followUpTone(status: ReviewFollowUpStatus) {
  switch (status) {
    case "required":
      return "danger" as const;
    case "done":
      return "success" as const;
    default:
      return "default" as const;
  }
}

/** Delay presets of the settings form (minutes). */
export const REVIEW_DELAY_OPTIONS = [30, 60, 120, 240, 480, 1440, 2880];

export const REVIEW_HOURS = Array.from({ length: 24 }, (_, h) => h);

export function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}
