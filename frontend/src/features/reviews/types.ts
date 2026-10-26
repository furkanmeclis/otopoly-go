import type { components } from "@/generated/api";

export type Review = components["schemas"]["Review"];
export type ReviewDetail = components["schemas"]["ReviewDetail"];
export type ReviewStatus = components["schemas"]["ReviewStatus"];
export type ReviewFollowUpStatus =
  components["schemas"]["ReviewFollowUpStatus"];
export type ReviewChannelPreference =
  components["schemas"]["ReviewChannelPreference"];
export type ReviewSummary = components["schemas"]["ReviewSummary"];
export type ReviewSettings = components["schemas"]["ReviewSettings"];
export type UpdateReviewSettingsInput =
  components["schemas"]["UpdateReviewSettingsRequest"];
export type ReviewTestResult = components["schemas"]["ReviewTestResult"];
export type PublicReview = components["schemas"]["PublicReview"];
export type ReviewGoogleRedirect =
  components["schemas"]["ReviewGoogleRedirect"];

export type ReviewListParams = {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
  status?: ReviewStatus;
  follow_up?: ReviewFollowUpStatus;
  rating?: "high" | "low";
  score?: number;
  channel?: "sms" | "whatsapp";
  customer_uuid?: string;
  days?: number;
  include_tests?: boolean;
};

export type ReviewPage = {
  items: Review[];
  total: number;
  limit: number;
  offset: number;
};

export const REVIEW_STATUSES: ReviewStatus[] = [
  "scheduled",
  "sent",
  "opened",
  "answered",
  "expired",
  "cancelled",
  "skipped",
  "failed",
];

export const REVIEW_FOLLOW_UPS: ReviewFollowUpStatus[] = [
  "none",
  "required",
  "done",
];
