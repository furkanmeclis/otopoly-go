import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";

/** Shapes of /v1/tenant/loyalty/* (backend internal/modules/loyalty). */

export type LoyaltyRef = { uuid: string; name: string };

export type RewardType = "free_service" | "percent" | "fixed";
export type LoyaltyKind = "reward" | "package" | "subscription";
export type PaymentMethod = "cash" | "card" | "cari";
export type PackageState = "active" | "expired" | "used_up" | "cancelled";
export type SubscriptionState = "active" | "past_due" | "cancelled";

export type LoyaltyCampaign = {
  uuid: string;
  name: string;
  description: string;
  services: LoyaltyRef[];
  categories: LoyaltyRef[];
  stamps_required: number;
  reward_type: RewardType;
  reward_service?: LoyaltyRef;
  reward_value: string;
  valid_from?: string;
  valid_until?: string;
  is_active: boolean;
  per_customer_limit?: number;
  created_at: string;
  updated_at: string;
};

export type CampaignInput = {
  name: string;
  description?: string;
  service_uuids: string[];
  category_uuids: string[];
  stamps_required: number;
  reward_type: RewardType;
  reward_service_uuid?: string | null;
  reward_value?: string;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
  per_customer_limit?: number | null;
};

export type LoyaltyPackageItem = {
  service_uuid: string;
  service_name: string;
  quantity: number;
  unit_price: string;
};

export type LoyaltyPackage = {
  uuid: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  validity_days?: number;
  is_active: boolean;
  items: LoyaltyPackageItem[];
  list_value: string;
  sold_count: number;
  created_at: string;
  updated_at: string;
};

export type PackageInput = {
  name: string;
  description?: string;
  price: string;
  currency?: string;
  validity_days?: number | null;
  is_active?: boolean;
  items: { service_uuid: string; quantity: number }[];
};

export type LoyaltyPlan = {
  uuid: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  period_months: number;
  uses_per_period?: number;
  services: LoyaltyRef[];
  categories: LoyaltyRef[];
  is_active: boolean;
  active_count: number;
  created_at: string;
  updated_at: string;
};

export type PlanInput = {
  name: string;
  description?: string;
  price: string;
  currency?: string;
  period_months: number;
  uses_per_period?: number | null;
  service_uuids: string[];
  category_uuids: string[];
  is_active?: boolean;
};

export type LoyaltyCredit = {
  service_uuid: string;
  service_name: string;
  total: number;
  used: number;
  remaining: number;
};

export type CustomerPackage = {
  uuid: string;
  package_uuid?: string;
  customer_uuid: string;
  customer_name: string;
  name: string;
  price: string;
  currency: string;
  state: PackageState;
  purchased_at: string;
  expires_at?: string;
  payment_method: PaymentMethod;
  credits_total: number;
  credits_used: number;
  credits: LoyaltyCredit[];
  notes: string;
  cancelled_at?: string;
};

export type LoyaltyUsage = {
  uuid: string;
  job_uuid: string;
  plate: string;
  line_name: string;
  units: number;
  discount_amount: string;
  status: "applied" | "reverted";
  period_start?: string;
  created_at: string;
};

export type CustomerPackageDetail = CustomerPackage & { usage: LoyaltyUsage[] };

export type LoyaltyPeriod = {
  start: string;
  end: string;
  used: number;
  limit?: number;
  remaining?: number;
};

export type Subscription = {
  uuid: string;
  plan_uuid?: string;
  customer_uuid: string;
  customer_name: string;
  customer_phone: string;
  vehicle_uuid?: string;
  plate?: string;
  name: string;
  price: string;
  currency: string;
  period_months: number;
  uses_per_period?: number;
  start_date: string;
  renewal_date: string;
  days_until_renewal: number;
  state: SubscriptionState;
  current_period?: LoyaltyPeriod;
  notes: string;
  cancelled_at?: string;
  created_at: string;
};

export type SubscriptionPayment = {
  uuid: string;
  period_start: string;
  period_end: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  finance_account_name?: string;
  created_at: string;
};

export type SubscriptionDetail = Subscription & {
  next_period: LoyaltyPeriod;
  payments: SubscriptionPayment[];
  usage: LoyaltyUsage[];
};

export type PaymentInput = {
  method: PaymentMethod;
  finance_account_uuid?: string | null;
};

export type StampCard = {
  campaign_uuid: string;
  campaign_name: string;
  stamps_required: number;
  stamps: number;
  balance: number;
  rewards_available: number;
  rewards_redeemed: number;
  reward_type: RewardType;
  reward_value: string;
  reward_service?: LoyaltyRef;
  active: boolean;
  limit_reached: boolean;
};

export type CustomerLoyalty = {
  customer_uuid: string;
  stamps: StampCard[];
  packages: CustomerPackage[];
  subscriptions: Subscription[];
  rewards_available: number;
};

export type LoyaltyApplication = {
  uuid: string;
  kind: LoyaltyKind;
  source_uuid?: string;
  source_name: string;
  line_uuid: string;
  line_name: string;
  units: number;
  discount_amount: string;
  status: "applied" | "reverted";
  created_at: string;
};

export type LoyaltyOption = {
  kind: LoyaltyKind;
  source_uuid: string;
  source_name: string;
  line_uuid: string;
  line_name: string;
  units: number;
  discount_amount: string;
  remaining?: number;
};

export type JobLoyalty = {
  job_uuid: string;
  customer_uuid: string;
  editable: boolean;
  applied: LoyaltyApplication[];
  options: LoyaltyOption[];
  stamps: StampCard[];
  stamps_earned: LoyaltyRef[];
};

export type LoyaltyOverview = {
  active_campaigns: number;
  active_packages: number;
  active_plans: number;
  customer_packages_active: number;
  subscriptions_active: number;
  subscriptions_past_due: number;
  renewals_upcoming: number;
  horizon_days: number;
  renewals: Subscription[];
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

type ListParams = ServerListParams & { is_active?: string };

const base = "/v1/tenant/loyalty";

export const loyaltyService = {
  overview(days?: number, silent?: boolean) {
    return platformRequest<LoyaltyOverview>("GET", `${base}/overview`, {
      query: days ? { days } : undefined,
      silent,
    });
  },

  listCampaigns(params?: ListParams) {
    return platformRequest<ListPage<LoyaltyCampaign>>(
      "GET",
      `${base}/campaigns`,
      { query: params },
    );
  },
  createCampaign(body: CampaignInput) {
    return platformRequest<LoyaltyCampaign>("POST", `${base}/campaigns`, {
      body,
    });
  },
  updateCampaign(uuid: string, body: CampaignInput) {
    return platformRequest<LoyaltyCampaign>(
      "PUT",
      `${base}/campaigns/${uuid}`,
      { body },
    );
  },
  deleteCampaign(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `${base}/campaigns/${uuid}`,
    );
  },

  listPackages(params?: ListParams) {
    return platformRequest<ListPage<LoyaltyPackage>>(
      "GET",
      `${base}/packages`,
      { query: params },
    );
  },
  createPackage(body: PackageInput) {
    return platformRequest<LoyaltyPackage>("POST", `${base}/packages`, {
      body,
    });
  },
  updatePackage(uuid: string, body: PackageInput) {
    return platformRequest<LoyaltyPackage>("PUT", `${base}/packages/${uuid}`, {
      body,
    });
  },
  deletePackage(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `${base}/packages/${uuid}`,
    );
  },

  listPlans(params?: ListParams) {
    return platformRequest<ListPage<LoyaltyPlan>>("GET", `${base}/plans`, {
      query: params,
    });
  },
  createPlan(body: PlanInput) {
    return platformRequest<LoyaltyPlan>("POST", `${base}/plans`, { body });
  },
  updatePlan(uuid: string, body: PlanInput) {
    return platformRequest<LoyaltyPlan>("PUT", `${base}/plans/${uuid}`, {
      body,
    });
  },
  deletePlan(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `${base}/plans/${uuid}`,
    );
  },

  listCustomerPackages(
    params?: ServerListParams & { customer_uuid?: string; state?: string },
  ) {
    return platformRequest<ListPage<CustomerPackage>>(
      "GET",
      `${base}/customer-packages`,
      { query: params },
    );
  },
  getCustomerPackage(uuid: string) {
    return platformRequest<CustomerPackageDetail>(
      "GET",
      `${base}/customer-packages/${uuid}`,
    );
  },
  sellPackage(body: {
    package_uuid: string;
    customer_uuid: string;
    method: PaymentMethod;
    finance_account_uuid?: string | null;
    notes?: string;
  }) {
    return platformRequest<CustomerPackageDetail>(
      "POST",
      `${base}/customer-packages`,
      { body },
    );
  },
  cancelCustomerPackage(uuid: string) {
    return platformRequest<CustomerPackageDetail & { refunded: boolean }>(
      "POST",
      `${base}/customer-packages/${uuid}/cancel`,
    );
  },

  listSubscriptions(
    params?: ServerListParams & {
      customer_uuid?: string;
      state?: string;
      due_within_days?: number;
    },
  ) {
    return platformRequest<ListPage<Subscription>>(
      "GET",
      `${base}/subscriptions`,
      { query: params },
    );
  },
  getSubscription(uuid: string) {
    return platformRequest<SubscriptionDetail>(
      "GET",
      `${base}/subscriptions/${uuid}`,
    );
  },
  startSubscription(body: {
    plan_uuid: string;
    customer_uuid: string;
    vehicle_uuid?: string | null;
    start_date?: string | null;
    notes?: string;
    payment?: PaymentInput | null;
  }) {
    return platformRequest<SubscriptionDetail>(
      "POST",
      `${base}/subscriptions`,
      { body },
    );
  },
  paySubscription(uuid: string, body: PaymentInput) {
    return platformRequest<SubscriptionDetail>(
      "POST",
      `${base}/subscriptions/${uuid}/payments`,
      { body },
    );
  },
  cancelSubscription(uuid: string) {
    return platformRequest<SubscriptionDetail>(
      "POST",
      `${base}/subscriptions/${uuid}/cancel`,
    );
  },

  customerLoyalty(customerUuid: string) {
    return platformRequest<CustomerLoyalty>(
      "GET",
      `/v1/tenant/customers/${customerUuid}/loyalty`,
      { silent: true },
    );
  },
  jobLoyalty(jobUuid: string) {
    return platformRequest<JobLoyalty>(
      "GET",
      `/v1/tenant/jobs/${jobUuid}/loyalty`,
      { silent: true },
    );
  },
  applyToJob(
    jobUuid: string,
    body: { kind: LoyaltyKind; source_uuid: string; line_uuid: string },
  ) {
    return platformRequest<JobLoyalty>(
      "POST",
      `/v1/tenant/jobs/${jobUuid}/loyalty/apply`,
      { body },
    );
  },
  revertOnJob(jobUuid: string, applicationUuid: string) {
    return platformRequest<JobLoyalty>(
      "POST",
      `/v1/tenant/jobs/${jobUuid}/loyalty/${applicationUuid}/revert`,
    );
  },
};
