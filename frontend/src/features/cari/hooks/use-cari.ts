"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  cariService,
  type AdjustmentInput,
  type ChargeInput,
  type PaymentInput,
} from "@/features/cari/services/cari.service";
import { useLocale } from "@/providers/locale-provider";

export const cariKeys = {
  all: ["tenant", "cari"] as const,
  summary: () => [...cariKeys.all, "summary"] as const,
  meta: () => [...cariKeys.all, "meta"] as const,
  list: (params?: unknown) => [...cariKeys.all, "list", params] as const,
  detail: (uuid: string) => [...cariKeys.all, "detail", uuid] as const,
  entries: (accountUuid: string, params?: unknown) =>
    [...cariKeys.all, "entries", accountUuid, params] as const,
};

export function useCariSummary() {
  return useQuery({
    queryKey: cariKeys.summary(),
    queryFn: () => cariService.summary(),
  });
}

export function useCariMeta() {
  return useQuery({
    queryKey: cariKeys.meta(),
    queryFn: () => cariService.meta(),
  });
}

export function useCariAccounts(
  params?: ServerListParams & { is_active?: string; has_balance?: string },
) {
  return useQuery({
    queryKey: cariKeys.list(params),
    queryFn: () => cariService.list(params),
  });
}

export function useCariAccount(uuid: string) {
  return useQuery({
    queryKey: cariKeys.detail(uuid),
    queryFn: () => cariService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCariEntries(
  accountUuid: string,
  params?: ServerListParams & {
    type?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  },
) {
  return useQuery({
    queryKey: cariKeys.entries(accountUuid, params),
    queryFn: () => cariService.listEntries(accountUuid, params),
    enabled: Boolean(accountUuid),
  });
}

export function useCariMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const invalidateAll = () =>
    queryClient.invalidateQueries({ queryKey: cariKeys.all });

  const invalidateAccount = (accountUuid: string) => {
    void queryClient.invalidateQueries({
      queryKey: cariKeys.detail(accountUuid),
    });
    void queryClient.invalidateQueries({
      queryKey: [...cariKeys.all, "entries", accountUuid],
    });
  };

  return {
    charge: useMutation({
      mutationFn: ({
        accountUuid,
        body,
      }: {
        accountUuid: string;
        body: ChargeInput;
      }) => cariService.charge(accountUuid, body),
      onSuccess: (_data, vars) => {
        invalidateAll();
        invalidateAccount(vars.accountUuid);
        toast.success(t("cari.toast.charge"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("cari.toast.failed")),
    }),
    payment: useMutation({
      mutationFn: ({
        accountUuid,
        body,
      }: {
        accountUuid: string;
        body: PaymentInput;
      }) => cariService.payment(accountUuid, body),
      onSuccess: (_data, vars) => {
        invalidateAll();
        invalidateAccount(vars.accountUuid);
        toast.success(t("cari.toast.payment"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("cari.toast.failed")),
    }),
    adjustment: useMutation({
      mutationFn: ({
        accountUuid,
        body,
      }: {
        accountUuid: string;
        body: AdjustmentInput;
      }) => cariService.adjustment(accountUuid, body),
      onSuccess: (_data, vars) => {
        invalidateAll();
        invalidateAccount(vars.accountUuid);
        toast.success(t("cari.toast.adjustment"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("cari.toast.failed")),
    }),
    voidEntry: useMutation({
      mutationFn: ({
        entryUuid,
        accountUuid,
      }: {
        entryUuid: string;
        accountUuid: string;
      }) => cariService.voidEntry(entryUuid),
      onSuccess: (_data, vars) => {
        invalidateAll();
        invalidateAccount(vars.accountUuid);
        toast.success(t("cari.toast.void"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("cari.toast.failed")),
    }),
  };
}
