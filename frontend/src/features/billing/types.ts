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

export type QuoteLine = S["BillingQuoteLine"];
export type PlanRef = { uuid: string; code: string; name: string };
export type OrgRef = { uuid: string; slug: string; name: string };

export type OrderPreviewInput = {
  plan_uuid: string;
  period: SubscriptionPeriod;
  discount_code?: string;
};

export type OrderPreview = S["BillingOrderPreview"];

export type BankInstructions = S["BillingBankInstructions"];

export type BillingOrder = S["BillingOrder"];

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
export type DiscountCode = S["BillingDiscountCode"];
export type DiscountCodeInput = Omit<
  DiscountCode,
  "uuid" | "used_count" | "created_at"
>;

export type AdminSubscription = Omit<
  S["BillingAdminSubscription"],
  "status" | "source"
> & {
  grace_ends_at?: string | null;
  status: SubscriptionStatus;
  source: "self_service" | "admin";
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

export type PaymentSettings = S["BillingPaymentSettings"];

// --- Invoicing (F3) ---------------------------------------------------------

export type InvoiceStatus = "issued" | "failed" | "voided";
export type InvoiceProfile = S["BillingInvoiceProfile"];
export type BillingInvoice = S["BillingInvoice"];
export type SellerSettings = S["BillingSellerSettings"];

// --- Lifecycle & tracking (F4) ------------------------------------------------

export type BillingDashboard = {
  counts: { trial: number; active: number; grace: number; read_only: number };
  plans: Array<{ code: string; name: string; count: number }>;
  approved_this_month: { count: number; amount: string };
  orders: { pending_payment: number; payment_reported: number };
  expiring: { within_7: number; within_30: number };
  trial_conversion: { trials_90d: number; converted_90d: number; rate: number };
  discounts: Array<{
    code: string;
    uses: number;
    discount_total: string;
    revenue: string;
  }>;
};

export type AdminSubscriptionDetail = {
  subscription: AdminSubscription & { grace_ends_at?: string | null };
  history: AdminSubscription[];
  orders: BillingOrder[];
  invoices: BillingInvoice[];
  meters: BillingUsageMeter[];
};
