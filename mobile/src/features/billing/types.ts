/**
 * Plan / usage types. Entity shapes come from the OpenAPI-generated schemas.
 *
 * Mobile only reads the tenant's plan and usage (`GET /v1/tenant/billing/overview`); orders,
 * invoices, prices and payments are intentionally not part of the app.
 */
import type { components } from "@/api/generated/api";

type S = components["schemas"];

export type SubscriptionStatus =
  "trial" | "active" | "grace" | "read_only" | "cancelled";
export type SubscriptionPeriod = "monthly" | "yearly";

export type BillingPlan = S["BillingPlan"];
export type BillingUsageMeter = S["BillingUsageMeter"];
export type BillingSubscription = Omit<
  S["BillingSubscription"],
  "status" | "period" | "source"
> & {
  status: SubscriptionStatus;
  period: SubscriptionPeriod;
  source: "self_service" | "admin";
};
export type BillingOverview = Omit<
  S["BillingOverview"],
  "subscription" | "open_order"
> & {
  subscription: BillingSubscription | null;
  /** Unpaid web order, if any (always present, `null` when none). Not shown in the app (no purchases). */
  open_order: unknown | null;
};
