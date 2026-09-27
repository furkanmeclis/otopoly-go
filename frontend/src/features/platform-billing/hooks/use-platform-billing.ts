"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import type { BillingPlanInput, DisplayFeatureInput } from "@/features/billing/types";
import { platformBillingService } from "@/features/platform-billing/services/platform-billing.service";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const platformBillingKeys = {
  all: ["platform", "billing"] as const,
  plans: () => [...platformBillingKeys.all, "plans"] as const,
  features: () => [...platformBillingKeys.all, "features"] as const,
};

export function usePlatformBillingAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.platformBilling.read),
    canWrite: hasPermission(permissions.platformBilling.write),
  };
}

export function usePlatformPlans(enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.plans(),
    queryFn: () => platformBillingService.listPlans(),
    enabled,
  });
}

export function usePlatformFeatures(enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.features(),
    queryFn: () => platformBillingService.listFeatures(true),
    enabled,
    staleTime: 60_000,
  });
}

export function usePlatformPlanMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => qc.invalidateQueries({ queryKey: platformBillingKeys.plans() });
  return {
    create: useMutation({
      mutationFn: (body: BillingPlanInput) => platformBillingService.createPlan(body),
      onSuccess: () => {
        toast.success(t("billing.toast.plan_saved"));
        return invalidate();
      },
    }),
    update: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: BillingPlanInput }) =>
        platformBillingService.updatePlan(uuid, body),
      onSuccess: () => {
        toast.success(t("billing.toast.plan_saved"));
        return invalidate();
      },
    }),
    remove: useMutation({
      mutationFn: (uuid: string) => platformBillingService.deletePlan(uuid),
      onSuccess: () => {
        toast.success(t("billing.toast.plan_deleted"));
        return invalidate();
      },
    }),
  };
}

export function usePlatformFeatureMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => qc.invalidateQueries({ queryKey: platformBillingKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: DisplayFeatureInput) => platformBillingService.createFeature(body),
      onSuccess: () => {
        toast.success(t("billing.toast.feature_saved"));
        return invalidate();
      },
    }),
    setActive: useMutation({
      mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
        platformBillingService.setFeatureActive(id, isActive),
      onSuccess: () => invalidate(),
    }),
  };
}
