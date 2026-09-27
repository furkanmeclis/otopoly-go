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
export type BillingOverview = Omit<
  S["BillingOverview"],
  "subscription" | "open_order"
> & {
  subscription: BillingSubscription | null;
  open_order?: BillingOrder | null;
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

// --- Purchase (F2) ----------------------------------------------------------

export type OrderKind =
  "new" | "renew" | "upgrade" | "downgrade" | "period_change";
export type OrderStatus =
  | "pending_payment"
  | "payment_reported"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";
export type QuoteLineKind = "plan" | "proration" | "discount" | "credit";

export type QuoteLine = { kind: QuoteLineKind; label: string; amount: string };
export type PlanRef = { uuid: string; code: string; name: string };
export type OrgRef = { uuid: string; slug: string; name: string };

export type OrderPreviewInput = {
  plan_uuid: string;
  period: SubscriptionPeriod;
  discount_code?: string;
};

export type OrderPreview = {
  kind: OrderKind;
  plan: PlanRef;
  period: SubscriptionPeriod;
  list_price: string;
  proration_credit: string;
  discount_code: string | null;
  discount_amount: string;
  credit_applied: string;
  credit_surplus: string;
  total: string;
  vat_rate: number;
  vat_amount: string;
  starts_at: string;
  ends_at: string;
  lines: QuoteLine[];
  discount_error: { reason: string; message: string } | null;
};

export type BankInstructions = {
  bank_name: string;
  account_holder: string;
  iban: string;
  amount: string;
  reference_code: string;
  payment_instructions: string;
};

export type BillingOrder = {
  uuid: string;
  reference_code: string;
  kind: OrderKind;
  status: OrderStatus;
  channel: string;
  plan: PlanRef;
  period: SubscriptionPeriod;
  list_price: string;
  proration_credit: string;
  discount_code: string | null;
  discount_amount: string;
  credit_applied: string;
  credit_surplus: string;
  total: string;
  vat_amount: string;
  lines: QuoteLine[];
  has_receipt: boolean;
  receipt_content_type: string | null;
  report_note: string;
  reported_at: string | null;
  reviewed_at: string | null;
  reject_reason: string;
  expires_at: string;
  created_at: string;
  instructions: BankInstructions | null;
  organization: OrgRef | null;
};

export type ListResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type OrdersSummary = {
  pending_payment: number;
  payment_reported: number;
};

export type DiscountKind = "percent" | "amount";
export type DiscountCode = {
  uuid: string;
  code: string;
  kind: DiscountKind;
  value: string;
  plan_uuids: string[];
  periods: SubscriptionPeriod[];
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_org: number | null;
  first_purchase_only: boolean;
  is_active: boolean;
  note: string;
  used_count: number;
  created_at: string;
};
export type DiscountCodeInput = Omit<
  DiscountCode,
  "uuid" | "used_count" | "created_at"
>;

export type AdminSubscription = {
  uuid: string;
  organization: OrgRef;
  plan: PlanRef;
  period: SubscriptionPeriod;
  status: SubscriptionStatus;
  starts_at: string;
  ends_at: string;
  days_left: number;
  price_paid: string;
  credit_balance: string;
  source: "self_service" | "admin";
  note: string;
  created_at: string;
};
export type AdminSubscriptionInput = {
  organization_uuid: string;
  plan_uuid: string;
  period: SubscriptionPeriod;
  starts_at: string;
  ends_at: string;
  price_paid: string;
  note: string;
};
export type AdminSubscriptionPatch = {
  ends_at?: string;
  plan_uuid?: string;
  note?: string;
};

export type PaymentSettings = {
  bank_name: string;
  account_holder: string;
  iban: string;
  payment_instructions: string;
  order_ttl_days: number;
  grace_days: number;
  vat_rate: number;
};
