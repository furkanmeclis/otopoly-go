import type {
  UserListStatus,
  UserStatus,
} from "@/features/users/services/users.service";

/** Aligns with OpenAPI PublicUser / CreatePlatformUserRequest status examples. */
export const USER_STATUS_VALUES = [
  "active",
  "pending",
  "disabled",
] as const satisfies readonly UserStatus[];

/** Status column filter: live statuses plus the deleted-users view. */
export const USER_LIST_STATUS_VALUES = [
  ...USER_STATUS_VALUES,
  "deleted",
] as const satisfies readonly UserListStatus[];

export const USER_STATUS_TONE: Record<
  UserStatus,
  "success" | "danger" | "warning" | "default"
> = {
  active: "success",
  pending: "warning",
  disabled: "danger",
};

/** URL-synced (`?tab=`) sections of the platform user detail. */
export const USER_DETAIL_TABS = [
  "general",
  "organizations",
  "sessions",
  "devices",
  "notifications",
  "activity",
] as const;

export type UserDetailTab = (typeof USER_DETAIL_TABS)[number];
