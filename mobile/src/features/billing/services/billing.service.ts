import { platformRequest } from "@/api/client";
import type { BillingOverview } from "@/features/billing/types";

/**
 * Read-only plan usage. Mobile never calls the purchase, order, payment or invoice endpoints
 * (App Store 3.1.1 / Google Play payments policy); the backend e-mails the owner instead.
 */
export const billingService = {
  overview() {
    return platformRequest<BillingOverview>("GET", "/v1/tenant/billing/overview");
  },
};
