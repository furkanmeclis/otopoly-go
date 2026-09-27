import { platformRequest } from "@/lib/api/platform-request";
import type {
  AdminSubscription,
  AdminSubscriptionInput,
  AdminSubscriptionPatch,
  BillingFeature,
  BillingOrder,
  BillingPlan,
  BillingPlanInput,
  DiscountCode,
  DiscountCodeInput,
  DisplayFeatureInput,
  ListResult,
  OrdersSummary,
  PaymentSettings,
} from "@/features/billing/types";
import { apiConfig } from "@/config/api";

const base = "/v1/platform/billing";

export const platformBillingService = {
  listFeatures(includeInactive = true) {
    return platformRequest<BillingFeature[]>("GET", `${base}/features`, {
      query: { include_inactive: includeInactive ? "true" : undefined },
    });
  },
  createFeature(body: DisplayFeatureInput) {
    return platformRequest<BillingFeature>("POST", `${base}/features`, {
      body,
    });
  },
  setFeatureActive(id: number, isActive: boolean) {
    return platformRequest<BillingFeature>("PATCH", `${base}/features/${id}`, {
      body: { is_active: isActive },
    });
  },
  listPlans() {
    return platformRequest<BillingPlan[]>("GET", `${base}/plans`);
  },
  getPlan(uuid: string) {
    return platformRequest<BillingPlan>("GET", `${base}/plans/${uuid}`);
  },
  createPlan(body: BillingPlanInput) {
    return platformRequest<BillingPlan>("POST", `${base}/plans`, { body });
  },
  updatePlan(uuid: string, body: BillingPlanInput) {
    return platformRequest<BillingPlan>("PUT", `${base}/plans/${uuid}`, {
      body,
    });
  },
  deletePlan(uuid: string) {
    return platformRequest<void>("DELETE", `${base}/plans/${uuid}`);
  },
  listOrders(params: {
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    return platformRequest<ListResult<BillingOrder>>("GET", `${base}/orders`, {
      query: params,
    });
  },
  ordersSummary() {
    return platformRequest<OrdersSummary>("GET", `${base}/orders/summary`);
  },
  getOrder(uuid: string) {
    return platformRequest<BillingOrder>("GET", `${base}/orders/${uuid}`);
  },
  approveOrder(uuid: string, note: string) {
    return platformRequest<BillingOrder>(
      "POST",
      `${base}/orders/${uuid}/approve`,
      { body: { note } },
    );
  },
  rejectOrder(uuid: string, reason: string) {
    return platformRequest<BillingOrder>(
      "POST",
      `${base}/orders/${uuid}/reject`,
      { body: { reason } },
    );
  },
  receiptUrl(uuid: string) {
    return `${apiConfig.baseUrl.replace(/\/$/, "")}${base}/orders/${uuid}/receipt`;
  },
  listSubscriptions(params: {
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    return platformRequest<ListResult<AdminSubscription>>(
      "GET",
      `${base}/subscriptions`,
      { query: params },
    );
  },
  createSubscription(body: AdminSubscriptionInput) {
    return platformRequest<AdminSubscription>("POST", `${base}/subscriptions`, {
      body,
    });
  },
  updateSubscription(uuid: string, body: AdminSubscriptionPatch) {
    return platformRequest<AdminSubscription>(
      "PATCH",
      `${base}/subscriptions/${uuid}`,
      { body },
    );
  },
  listDiscountCodes(params: { q?: string; limit?: number; offset?: number }) {
    return platformRequest<ListResult<DiscountCode>>(
      "GET",
      `${base}/discount-codes`,
      { query: params },
    );
  },
  createDiscountCode(body: DiscountCodeInput) {
    return platformRequest<DiscountCode>("POST", `${base}/discount-codes`, {
      body,
    });
  },
  updateDiscountCode(uuid: string, body: DiscountCodeInput) {
    return platformRequest<DiscountCode>(
      "PUT",
      `${base}/discount-codes/${uuid}`,
      { body },
    );
  },
  deleteDiscountCode(uuid: string) {
    return platformRequest<DiscountCode | null>(
      "DELETE",
      `${base}/discount-codes/${uuid}`,
    );
  },
  getSettings() {
    return platformRequest<PaymentSettings>("GET", `${base}/settings`);
  },
  updateSettings(body: PaymentSettings) {
    return platformRequest<PaymentSettings>("PUT", `${base}/settings`, {
      body,
    });
  },
};
