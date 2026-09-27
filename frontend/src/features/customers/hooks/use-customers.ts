"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { isLimitError } from "@/lib/api/limit-events";

import type { ServerListParams } from "@/components/entity";
import { customersService } from "@/features/customers/services/customers.service";
import { useLocale } from "@/providers/locale-provider";

export const customerKeys = {
  all: ["tenant", "customers"] as const,
  list: (params?: unknown) => [...customerKeys.all, "list", params] as const,
  detail: (uuid: string) => [...customerKeys.all, "detail", uuid] as const,
};

export function useCustomers(
  params?: ServerListParams & { kind?: string; is_active?: string },
) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersService.list(params),
  });
}

export function useCustomer(uuid: string) {
  return useQuery({
    queryKey: customerKeys.detail(uuid),
    queryFn: () => customersService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCustomerMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: customerKeys.all });

  return {
    create: useMutation({
      mutationFn: customersService.create,
      onSuccess: () => {
        invalidate();
        void queryClient.invalidateQueries({ queryKey: ["tenant", "billing"] });
        toast.success(t("customers.toast.created"));
      },
      onError: (err: Error) => {
        if (isLimitError(err)) return; // LimitReachedDialog handles it
        toast.error(err.message || t("customers.toast.failed"));
      },
    }),
    update: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: Parameters<typeof customersService.update>[1];
      }) => customersService.update(uuid, body),
      onSuccess: () => {
        invalidate();
        toast.success(t("customers.toast.updated"));
      },
      onError: (err: Error) => {
        if (isLimitError(err)) return; // LimitReachedDialog handles it
        toast.error(err.message || t("customers.toast.failed"));
      },
    }),
    remove: useMutation({
      mutationFn: customersService.remove,
      onSuccess: () => {
        invalidate();
        void queryClient.invalidateQueries({ queryKey: ["tenant", "billing"] });
        toast.success(t("customers.toast.deleted"));
      },
      onError: (err: Error) => {
        if (isLimitError(err)) return; // LimitReachedDialog handles it
        toast.error(err.message || t("customers.toast.failed"));
      },
    }),
    addVehicle: useMutation({
      mutationFn: ({
        customerUuid,
        body,
      }: {
        customerUuid: string;
        body: Parameters<typeof customersService.addVehicle>[1];
      }) => customersService.addVehicle(customerUuid, body),
      onSuccess: () => {
        invalidate();
        toast.success(t("customers.toast.vehicle"));
      },
      onError: (err: Error) => {
        if (isLimitError(err)) return; // LimitReachedDialog handles it
        toast.error(err.message || t("customers.toast.failed"));
      },
    }),
    removeVehicle: useMutation({
      mutationFn: customersService.removeVehicle,
      onSuccess: () => {
        invalidate();
        toast.success(t("customers.toast.vehicle_removed"));
      },
      onError: (err: Error) => {
        if (isLimitError(err)) return; // LimitReachedDialog handles it
        toast.error(err.message || t("customers.toast.failed"));
      },
    }),
  };
}
