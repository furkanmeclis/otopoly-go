"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import type {
  AdminSubscriptionInput,
  AdminSubscriptionPatch,
  BillingPlanInput,
  DiscountCodeInput,
  DisplayFeatureInput,
  PaymentSettings,
} from "@/features/billing/types";
import { platformBillingService } from "@/features/platform-billing/services/platform-billing.service";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const platformBillingKeys = {
  all: ["platform", "billing"] as const,
  plans: () => [...platformBillingKeys.all, "plans"] as const,
  features: () => [...platformBillingKeys.all, "features"] as const,
  orders: (p: object) => [...platformBillingKeys.all, "orders", p] as const,
  ordersSummary: () => [...platformBillingKeys.all, "orders-summary"] as const,
  order: (uuid: string) => [...platformBillingKeys.all, "order", uuid] as const,
  subscriptions: (p: object) =>
    [...platformBillingKeys.all, "subscriptions", p] as const,
  discountCodes: (p: object) =>
    [...platformBillingKeys.all, "discount-codes", p] as const,
  settings: () => [...platformBillingKeys.all, "settings"] as const,
};

export function usePlatformBillingAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.platformBilling.read),
    canWrite: hasPermission(permissions.platformBilling.write),
    canSettings: hasPermission(permissions.platformBilling.settings),
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
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: platformBillingKeys.plans() });
  return {
    create: useMutation({
      mutationFn: (body: BillingPlanInput) =>
        platformBillingService.createPlan(body),
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
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: platformBillingKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: DisplayFeatureInput) =>
        platformBillingService.createFeature(body),
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

type ListParams = {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export function usePlatformOrders(params: ListParams, enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.orders(params),
    queryFn: () => platformBillingService.listOrders(params),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function usePlatformOrdersSummary(enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.ordersSummary(),
    queryFn: () => platformBillingService.ordersSummary(),
    enabled,
    refetchInterval: 60_000,
  });
}

export function usePlatformOrder(uuid: string | null) {
  return useQuery({
    queryKey: platformBillingKeys.order(uuid ?? ""),
    queryFn: () => platformBillingService.getOrder(uuid!),
    enabled: Boolean(uuid),
  });
}

export function usePlatformOrderMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: platformBillingKeys.all });
  return {
    approve: useMutation({
      mutationFn: ({ uuid, note }: { uuid: string; note: string }) =>
        platformBillingService.approveOrder(uuid, note),
      onSuccess: () => {
        toast.success(t("billing.payments.approved"));
        return invalidate();
      },
    }),
    reject: useMutation({
      mutationFn: ({ uuid, reason }: { uuid: string; reason: string }) =>
        platformBillingService.rejectOrder(uuid, reason),
      onSuccess: () => {
        toast.success(t("billing.payments.rejected"));
        return invalidate();
      },
    }),
  };
}

export function usePlatformSubscriptions(params: ListParams, enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.subscriptions(params),
    queryFn: () => platformBillingService.listSubscriptions(params),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function usePlatformSubscriptionMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: platformBillingKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: AdminSubscriptionInput) =>
        platformBillingService.createSubscription(body),
      onSuccess: () => {
        toast.success(t("billing.subs.saved"));
        return invalidate();
      },
    }),
    update: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: AdminSubscriptionPatch;
      }) => platformBillingService.updateSubscription(uuid, body),
      onSuccess: () => {
        toast.success(t("billing.subs.saved"));
        return invalidate();
      },
    }),
  };
}

export function usePlatformDiscountCodes(params: ListParams, enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.discountCodes(params),
    queryFn: () => platformBillingService.listDiscountCodes(params),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function usePlatformDiscountMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: platformBillingKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: DiscountCodeInput) =>
        platformBillingService.createDiscountCode(body),
      onSuccess: () => {
        toast.success(t("billing.discounts.saved"));
        return invalidate();
      },
    }),
    update: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: DiscountCodeInput }) =>
        platformBillingService.updateDiscountCode(uuid, body),
      onSuccess: () => {
        toast.success(t("billing.discounts.saved"));
        return invalidate();
      },
    }),
    remove: useMutation({
      mutationFn: (uuid: string) =>
        platformBillingService.deleteDiscountCode(uuid),
      onSuccess: (res) => {
        toast.success(
          res && res.is_active === false
            ? t("billing.discounts.deactivated")
            : t("billing.discounts.deleted"),
        );
        return invalidate();
      },
    }),
  };
}

export function usePaymentSettings(enabled = true) {
  return useQuery({
    queryKey: platformBillingKeys.settings(),
    queryFn: () => platformBillingService.getSettings(),
    enabled,
  });
}

export function usePaymentSettingsMutation() {
  const qc = useQueryClient();
  const { t } = useLocale();
  return useMutation({
    mutationFn: (body: PaymentSettings) =>
      platformBillingService.updateSettings(body),
    onSuccess: (data) => {
      toast.success(t("billing.settings.saved"));
      qc.setQueryData(platformBillingKeys.settings(), data);
    },
  });
}
