/**
 * Billing types. Entity shapes come from the OpenAPI-generated schemas; the
 * input/helper types below are frontend-only.
 */
import type { components } from "@/generated/api";

type S = components["schemas"];

export type BillingFeatureKind = "limit" | "toggle" | "display";
export type BillingPeriod = "day" | "month" | "total" | "none";
export type BillingEnforcement = "hard" | "soft";
export type SubscriptionStatus =
  "trial" | "active" | "grace" | "read_only" | "cancelled";
export type SubscriptionPeriod = "monthly" | "yearly";
export type YearlyPricing = "fixed" | "discount_amount" | "discount_percent";

export type BillingFeature = S["BillingFeature"];
export type BillingPlanFeatureValue = S["BillingPlanFeatureValue"];
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
export type BillingOverview = Omit<S["BillingOverview"], "subscription"> & {
  subscription: BillingSubscription | null;
};

export type BillingPlanInput = Omit<
  BillingPlan,
  "uuid" | "effective_yearly" | "currency" | "live_subscriptions"
> & { features: BillingPlanFeatureValue[] };

export type DisplayFeatureInput = {
  key: string;
  label_tr: string;
  label_en: string;
  sort_order: number;
};
