import type { OrganizationStatus } from "@/features/organizations/services/organizations.service";

export const ORGANIZATION_STATUS_VALUES = [
  "pending",
  "active",
  "suspended",
  "expired",
] as const satisfies readonly OrganizationStatus[];

export const ORGANIZATION_STATUS_TONE: Record<
  OrganizationStatus,
  "success" | "danger" | "warning" | "default"
> = {
  active: "success",
  pending: "warning",
  suspended: "danger",
  expired: "danger",
};

export const ORGANIZATION_MEMBER_ROLES = ["owner", "staff"] as const;

export function organizationStatusTone(status: string) {
  return status in ORGANIZATION_STATUS_TONE
    ? ORGANIZATION_STATUS_TONE[status as OrganizationStatus]
    : ("default" as const);
}

/** URL-synced (`?tab=`) sections of the platform organization detail. */
export const ORGANIZATION_DETAIL_TABS = [
  "general",
  "members",
  "subscription",
  "whatsapp",
  "stats",
  "activity",
] as const;

export type OrganizationDetailTab = (typeof ORGANIZATION_DETAIL_TABS)[number];
