"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import { billingService } from "@/features/billing/services/billing.service";
import type { OrderPreviewInput } from "@/features/billing/types";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const billingKeys = {
  all: ["tenant", "billing"] as const,
  overview: () => [...billingKeys.all, "overview"] as const,
  plans: () => [...billingKeys.all, "plans"] as const,
  preview: (input: OrderPreviewInput) =>
    [...billingKeys.all, "preview", input] as const,
  orders: (status: "open" | "all") =>
    [...billingKeys.all, "orders", status] as const,
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

export function useOrderPreview(input: OrderPreviewInput | null) {
  return useQuery({
    queryKey: billingKeys.preview(
      input ?? { plan_uuid: "", period: "monthly" },
    ),
    queryFn: () => billingService.preview(input!),
    enabled: Boolean(input?.plan_uuid),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useBillingOrders(
  status: "open" | "all" = "all",
  enabled = true,
) {
  return useQuery({
    queryKey: billingKeys.orders(status),
    queryFn: () => billingService.orders(status),
    enabled,
  });
}

export function useBillingOrderMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => qc.invalidateQueries({ queryKey: billingKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: OrderPreviewInput) => billingService.createOrder(body),
      onSuccess: () => invalidate(),
    }),
    report: useMutation({
      mutationFn: ({
        uuid,
        file,
        note,
      }: {
        uuid: string;
        file: File;
        note: string;
      }) => billingService.reportPayment(uuid, file, note),
      onSuccess: () => {
        toast.success(t("billing.report.success"));
        return invalidate();
      },
    }),
    cancel: useMutation({
      mutationFn: (uuid: string) => billingService.cancelOrder(uuid),
      onSuccess: () => {
        toast.success(t("billing.toast.order_cancelled"));
        return invalidate();
      },
    }),
  };
}
