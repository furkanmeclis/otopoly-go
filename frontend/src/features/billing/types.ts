/**
 * Billing types. These mirror the OpenAPI schemas (BillingOverview etc.);
 * once `pnpm api:generate` includes them they can be re-pointed at
 * `components["schemas"]` without touching consumers.
 */
export type BillingFeatureKind = "limit" | "toggle" | "display";
export type BillingPeriod = "day" | "month" | "total" | "none";
export type BillingEnforcement = "hard" | "soft";
export type SubscriptionStatus =
  "trial" | "active" | "grace" | "read_only" | "cancelled";
export type SubscriptionPeriod = "monthly" | "yearly";
export type YearlyPricing = "fixed" | "discount_amount" | "discount_percent";

export type BillingFeature = {
  id: number;
  key: string;
  kind: BillingFeatureKind;
  unit: string;
  period: BillingPeriod;
  label_tr: string;
  label_en: string;
  sort_order: number;
  is_builtin: boolean;
  is_active: boolean;
};

export type BillingPlanFeatureValue = {
  key: string;
  value_int?: number | null;
  value_bool?: boolean | null;
  display_text?: string;
  enforcement: BillingEnforcement;
  tolerance_pct: number;
  warn_pct: number;
  min_value?: number | null;
  max_value?: number | null;
  step?: number | null;
  unit_price?: string | null;
};

export type BillingPlan = {
  uuid: string;
  code: string;
  name: string;
  description: string;
  price_monthly: string;
  yearly_pricing: YearlyPricing;
  price_yearly: string;
  yearly_discount_value: string;
  effective_yearly: string;
  currency: string;
  trial_days: number;
  is_public: boolean;
  is_customizable: boolean;
  is_active: boolean;
  badge: string;
  sort_order: number;
  features: BillingPlanFeatureValue[];
  live_subscriptions: number;
};

export type BillingPlanInput = Omit<
  BillingPlan,
  "uuid" | "effective_yearly" | "currency" | "live_subscriptions"
>;

export type BillingUsageMeter = {
  key: string;
  kind: BillingFeatureKind;
  unit: string;
  period: BillingPeriod;
  period_key: string;
  limit?: number | null;
  used: number;
  warn_pct: number;
  tolerance_pct: number;
  enforcement: BillingEnforcement;
  enabled?: boolean | null;
  label_tr: string;
  label_en: string;
};

export type BillingSubscription = {
  uuid: string;
  plan_code: string;
  plan_name: string;
  period: SubscriptionPeriod;
  status: SubscriptionStatus;
  starts_at: string;
  ends_at: string;
  grace_ends_at?: string | null;
  days_left: number;
  credit_balance: string;
  source: "self_service" | "admin";
};

export type BillingOverview = {
  subscription?: BillingSubscription | null;
  plan?: BillingPlan | null;
  meters: BillingUsageMeter[];
};

export type DisplayFeatureInput = {
  key: string;
  label_tr: string;
  label_en: string;
  sort_order: number;
};
