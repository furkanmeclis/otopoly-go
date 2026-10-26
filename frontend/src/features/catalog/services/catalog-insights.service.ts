import type { components } from "@/generated/api";
import { platformRequest } from "@/lib/api/platform-request";

type Schemas = components["schemas"];

export type ProductSummary = Schemas["ProductSummary"];
export type ProductMovement = Schemas["ProductMovement"];
export type ServiceSummary = Schemas["ServiceSummary"];
export type ServiceJob = Schemas["ServiceJob"];

/** 360° summaries of the catalog detail pages (org-scoped, permission-gated blocks). */
export const catalogInsightsService = {
  productSummary(uuid: string) {
    return platformRequest<ProductSummary>(
      "GET",
      `/v1/tenant/catalog/products/${uuid}/summary`,
    );
  },
  productMovements(uuid: string, limit = 100) {
    return platformRequest<{ items: ProductMovement[]; total: number }>(
      "GET",
      `/v1/tenant/catalog/products/${uuid}/movements`,
      { query: { limit } },
    );
  },
  serviceSummary(uuid: string) {
    return platformRequest<ServiceSummary>(
      "GET",
      `/v1/tenant/catalog/services/${uuid}/summary`,
    );
  },
  serviceJobs(uuid: string, limit = 100) {
    return platformRequest<{ items: ServiceJob[]; total: number }>(
      "GET",
      `/v1/tenant/catalog/services/${uuid}/jobs`,
      { query: { limit } },
    );
  },
};
