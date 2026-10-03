import type { components } from "@/generated/api";
import type { OrganizationSummary } from "@/lib/auth/types";

export type CreateOwnedOrganizationRequest =
  components["schemas"]["CreateOwnedOrganizationRequest"];

/** What went wrong with POST /v1/auth/organizations, as the UI handles it. */
export type CreateBusinessFailure =
  | "already_owner" // 409: switch into the business the user owns
  | "registration_closed" // 403: explain + offer sign-out
  | "rate_limited" // 429
  | "validation" // 400 / 422
  | "unauthenticated" // 401 after the BFF refresh attempt
  | "network" // no HTTP response (offline, DNS, aborted)
  | "unknown";

/** Maps a thrown error (ApiError or fetch failure) to a failure kind. */
export function classifyCreateBusinessError(
  error: unknown,
): CreateBusinessFailure {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  if (typeof status !== "number") {
    // fetch() rejects with a TypeError when no response arrives.
    return error instanceof TypeError ? "network" : "unknown";
  }
  if (status === 409) return "already_owner";
  if (status === 403) return "registration_closed";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "unauthenticated";
  return "unknown";
}

/** i18n key for failures shown inline in the wizard. */
export function createBusinessErrorKey(failure: CreateBusinessFailure): string {
  switch (failure) {
    case "rate_limited":
      return "register.create.errors.rate_limited";
    case "validation":
      return "register.create.errors.validation";
    case "network":
      return "register.create.errors.network";
    case "unauthenticated":
      return "register.create.errors.unauthenticated";
    case "registration_closed":
      return "register.create.closed_description";
    case "already_owner":
      return "register.create.errors.already_owner";
    default:
      return "register.create.errors.unknown";
  }
}

/** Trimmed API body; empty optional fields are left out. */
export function createBusinessPayload(values: {
  organization_name: string;
  phone?: string;
  city?: string;
  district?: string;
  address?: string;
}): CreateOwnedOrganizationRequest {
  const body: CreateOwnedOrganizationRequest = {
    organization_name: values.organization_name.trim(),
  };
  for (const key of ["phone", "city", "district", "address"] as const) {
    const value = values[key]?.trim();
    if (value) body[key] = value;
  }
  return body;
}

/** The business to open after a 409: the owned one, else any membership. */
export function pickOwnedOrganization(
  organizations: OrganizationSummary[],
): OrganizationSummary | null {
  return (
    organizations.find((org) => org.role === "owner") ??
    organizations[0] ??
    null
  );
}
