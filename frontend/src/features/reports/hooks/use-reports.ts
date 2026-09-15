"use client";

import { useQuery } from "@tanstack/react-query";

import {
  reportsService,
  type ReportsOverviewFilters,
} from "@/features/reports/services/reports.service";

export const reportsQueryKeys = {
  all: ["tenant", "reports"] as const,
  overview: (params?: ReportsOverviewFilters) =>
    [...reportsQueryKeys.all, "overview", params ?? {}] as const,
  meta: () => [...reportsQueryKeys.all, "meta"] as const,
};

export function useReportsOverview(params?: ReportsOverviewFilters) {
  return useQuery({
    queryKey: reportsQueryKeys.overview(params),
    queryFn: () => reportsService.overview(params),
  });
}

export function useReportsMeta() {
  return useQuery({
    queryKey: reportsQueryKeys.meta(),
    queryFn: () => reportsService.meta(),
  });
}
