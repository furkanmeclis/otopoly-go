"use client";

import { useQuery } from "@tanstack/react-query";

import { permissions } from "@/config/permissions";
import { billingService } from "@/features/billing/services/billing.service";
import { usePermission } from "@/providers/permission-provider";

export const billingKeys = {
  all: ["tenant", "billing"] as const,
  overview: () => [...billingKeys.all, "overview"] as const,
  plans: () => [...billingKeys.all, "plans"] as const,
};

export function useBillingAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.billing.read),
    canWrite: hasPermission(permissions.billing.write),
  };
}

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: billingKeys.overview(),
    queryFn: () => billingService.overview(),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useBillingPlans(enabled = true) {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: () => billingService.plans(),
    enabled,
    staleTime: 5 * 60_000,
  });
}
