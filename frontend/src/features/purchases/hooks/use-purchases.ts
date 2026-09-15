"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  purchasesService,
  type CreatePurchaseInput,
} from "@/features/purchases/services/purchases.service";
import { useLocale } from "@/providers/locale-provider";

export const purchasesKeys = {
  all: ["tenant", "purchases"] as const,
  meta: () => [...purchasesKeys.all, "meta"] as const,
  list: (params?: unknown) => [...purchasesKeys.all, "list", params] as const,
  detail: (uuid: string) => [...purchasesKeys.all, "detail", uuid] as const,
};

export function usePurchasesMeta() {
  return useQuery({
    queryKey: purchasesKeys.meta(),
    queryFn: () => purchasesService.meta(),
  });
}

export function usePurchases(
  params?: ServerListParams & {
    status?: string;
    date_from?: string;
    date_to?: string;
  },
) {
  return useQuery({
    queryKey: purchasesKeys.list(params),
    queryFn: () => purchasesService.list(params),
  });
}

export function usePurchase(uuid: string) {
  return useQuery({
    queryKey: purchasesKeys.detail(uuid),
    queryFn: () => purchasesService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function usePurchasesMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: purchasesKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: CreatePurchaseInput) => purchasesService.create(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("purchases.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("purchases.toast.failed")),
    }),
    voidPurchase: useMutation({
      mutationFn: (uuid: string) => purchasesService.void(uuid),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: purchasesKeys.detail(data.uuid),
        });
        toast.success(t("purchases.toast.voided"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("purchases.toast.failed")),
    }),
  };
}
