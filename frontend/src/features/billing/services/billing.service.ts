import { platformRequest } from "@/lib/api/platform-request";
import type { BillingOverview, BillingPlan } from "@/features/billing/types";

export const billingService = {
  overview() {
    return platformRequest<BillingOverview>("GET", "/v1/tenant/billing/overview");
  },
  plans() {
    return platformRequest<BillingPlan[]>("GET", "/v1/tenant/billing/plans");
  },
};
