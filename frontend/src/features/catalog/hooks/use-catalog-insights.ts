"use client";

import { useQuery } from "@tanstack/react-query";

import { catalogQueryKeys } from "@/features/catalog/hooks/use-catalog-queries";
import { catalogInsightsService } from "@/features/catalog/services/catalog-insights.service";

// Under catalogQueryKeys.all so catalog mutations (stock adjustment, edits)
// refresh the 360° tiles too.
const insightsKeys = {
  productSummary: (uuid: string) =>
    [...catalogQueryKeys.all, "insights", "product", uuid, "summary"] as const,
  productMovements: (uuid: string) =>
    [
      ...catalogQueryKeys.all,
      "insights",
      "product",
      uuid,
      "movements",
    ] as const,
  serviceSummary: (uuid: string) =>
    [...catalogQueryKeys.all, "insights", "service", uuid, "summary"] as const,
  serviceJobs: (uuid: string) =>
    [...catalogQueryKeys.all, "insights", "service", uuid, "jobs"] as const,
};

export function useProductSummary(uuid: string) {
  return useQuery({
    queryKey: insightsKeys.productSummary(uuid),
    queryFn: () => catalogInsightsService.productSummary(uuid),
    enabled: Boolean(uuid),
  });
}

export function useProductMovements(uuid: string, enabled = true) {
  return useQuery({
    queryKey: insightsKeys.productMovements(uuid),
    queryFn: () => catalogInsightsService.productMovements(uuid),
    enabled: Boolean(uuid) && enabled,
  });
}

export function useServiceSummary(uuid: string) {
  return useQuery({
    queryKey: insightsKeys.serviceSummary(uuid),
    queryFn: () => catalogInsightsService.serviceSummary(uuid),
    enabled: Boolean(uuid),
  });
}

export function useServiceJobs(uuid: string, enabled = true) {
  return useQuery({
    queryKey: insightsKeys.serviceJobs(uuid),
    queryFn: () => catalogInsightsService.serviceJobs(uuid),
    enabled: Boolean(uuid) && enabled,
  });
}
