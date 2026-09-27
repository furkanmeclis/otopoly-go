"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  salesService,
  type CreateSaleInput,
} from "@/features/sales/services/sales.service";
import { useLocale } from "@/providers/locale-provider";

export const salesKeys = {
  all: ["tenant", "sales"] as const,
  summary: (date?: string) => [...salesKeys.all, "summary", date] as const,
  meta: () => [...salesKeys.all, "meta"] as const,
  list: (params?: unknown) => [...salesKeys.all, "list", params] as const,
  detail: (uuid: string) => [...salesKeys.all, "detail", uuid] as const,
};

export function useSalesSummary(date?: string) {
  return useQuery({
    queryKey: salesKeys.summary(date),
    queryFn: () => salesService.summary(date),
  });
}

export function useSalesMeta() {
  return useQuery({
    queryKey: salesKeys.meta(),
    queryFn: () => salesService.meta(),
  });
}

export function useSales(
  params?: ServerListParams & {
    status?: string;
    date_from?: string;
    date_to?: string;
  },
) {
  return useQuery({
    queryKey: salesKeys.list(params),
    queryFn: () => salesService.list(params),
  });
}

export function useSale(uuid: string) {
  return useQuery({
    queryKey: salesKeys.detail(uuid),
    queryFn: () => salesService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useSalesMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: salesKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: CreateSaleInput) => salesService.create(body),
      onSuccess: (data) => {
        invalidate();
        toast.success(t("sales.toast.created"), {
          id: `sale-created-${data.uuid}`,
        });
      },
      onError: (err: Error) =>
        toast.error(err.message || t("sales.toast.failed")),
    }),
    voidSale: useMutation({
      mutationFn: (uuid: string) => salesService.void(uuid),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: salesKeys.detail(data.uuid),
        });
        toast.success(t("sales.toast.voided"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("sales.toast.failed")),
    }),
  };
}
