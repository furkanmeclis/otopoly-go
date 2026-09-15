"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  suppliersService,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from "@/features/suppliers/services/suppliers.service";
import { useLocale } from "@/providers/locale-provider";

export const supplierKeys = {
  all: ["tenant", "suppliers"] as const,
  meta: () => [...supplierKeys.all, "meta"] as const,
  list: (params?: unknown) => [...supplierKeys.all, "list", params] as const,
  detail: (uuid: string) => [...supplierKeys.all, "detail", uuid] as const,
};

export function useSuppliersMeta() {
  return useQuery({
    queryKey: supplierKeys.meta(),
    queryFn: () => suppliersService.meta(),
  });
}

export function useSuppliers(
  params?: ServerListParams & { is_active?: string },
) {
  return useQuery({
    queryKey: supplierKeys.list(params),
    queryFn: () => suppliersService.list(params),
  });
}

export function useSupplier(uuid: string) {
  return useQuery({
    queryKey: supplierKeys.detail(uuid),
    queryFn: () => suppliersService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useSupplierMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: supplierKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: CreateSupplierInput) => suppliersService.create(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("suppliers.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("suppliers.toast.failed")),
    }),
    update: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: UpdateSupplierInput;
      }) => suppliersService.update(uuid, body),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: supplierKeys.detail(data.uuid),
        });
        toast.success(t("suppliers.toast.updated"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("suppliers.toast.failed")),
    }),
    remove: useMutation({
      mutationFn: (uuid: string) => suppliersService.remove(uuid),
      onSuccess: () => {
        invalidate();
        toast.success(t("suppliers.toast.deleted"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("suppliers.toast.failed")),
    }),
  };
}
