import { platformRequest } from "@/lib/api/platform-request";
import type {
  BillingFeature,
  BillingPlan,
  BillingPlanInput,
  DisplayFeatureInput,
} from "@/features/billing/types";

const base = "/v1/platform/billing";

export const platformBillingService = {
  listFeatures(includeInactive = true) {
    return platformRequest<BillingFeature[]>("GET", `${base}/features`, {
      query: { include_inactive: includeInactive ? "true" : undefined },
    });
  },
  createFeature(body: DisplayFeatureInput) {
    return platformRequest<BillingFeature>("POST", `${base}/features`, { body });
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
    return platformRequest<BillingPlan>("PUT", `${base}/plans/${uuid}`, { body });
  },
  deletePlan(uuid: string) {
    return platformRequest<void>("DELETE", `${base}/plans/${uuid}`);
  },
};
