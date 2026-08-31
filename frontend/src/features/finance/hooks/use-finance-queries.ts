"use client";

import { useQuery } from "@tanstack/react-query";

import { financeQueryKeys } from "@/features/finance/hooks/query-keys";
import {
  financeService,
  type ListPage,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceSummary,
  type FinanceTransaction,
} from "@/features/finance/services/finance.service";
import type { ServerListParams } from "@/components/entity";

export function useFinanceSummary(params?: {
  date_from?: string;
  date_to?: string;
  currency?: string;
}) {
  return useQuery({
    queryKey: financeQueryKeys.summary(params),
    queryFn: () => financeService.summary(params),
  });
}

export function useFinanceAccounts(
  params?: ServerListParams & { is_active?: string },
) {
  return useQuery({
    queryKey: financeQueryKeys.accounts(params),
    queryFn: () => financeService.listAccounts(params),
  });
}

export function useFinanceAccount(uuid: string) {
  return useQuery({
    queryKey: financeQueryKeys.account(uuid),
    queryFn: () => financeService.getAccount(uuid),
    enabled: Boolean(uuid),
  });
}

export function useFinanceAccountDetail(
  uuid: string,
  params?: { limit?: number },
) {
  return useQuery({
    queryKey: financeQueryKeys.accountDetail(uuid, params),
    queryFn: () => financeService.getAccountDetail(uuid, params),
    enabled: Boolean(uuid),
  });
}

export function useFinanceAccountsMeta() {
  return useQuery({
    queryKey: financeQueryKeys.accountsMeta(),
    queryFn: () => financeService.accountsMeta(),
  });
}

export function useFinanceCategoriesMeta() {
  return useQuery({
    queryKey: financeQueryKeys.categoriesMeta(),
    queryFn: () => financeService.categoriesMeta(),
  });
}

export function useFinanceCategories(kind?: string) {
  return useQuery({
    queryKey: financeQueryKeys.categories({ kind }),
    queryFn: () => financeService.listCategories(kind ? { kind } : undefined),
  });
}

export function useFinanceCategory(uuid: string) {
  return useQuery({
    queryKey: financeQueryKeys.category(uuid),
    queryFn: () => financeService.getCategory(uuid),
    enabled: Boolean(uuid),
  });
}

export function useFinanceCategoryDetail(
  uuid: string,
  params?: { limit?: number },
) {
  return useQuery({
    queryKey: financeQueryKeys.categoryDetail(uuid, params),
    queryFn: () => financeService.getCategoryDetail(uuid, params),
    enabled: Boolean(uuid),
  });
}

export function useFinanceTransactions(
  params?: ServerListParams & {
    type?: string;
    status?: string;
    account_uuid?: string;
    category_uuid?: string;
    date_from?: string;
    date_to?: string;
  },
) {
  return useQuery({
    queryKey: financeQueryKeys.transactions(params),
    queryFn: () => financeService.listTransactions(params),
  });
}

export function useFinanceTransactionsMeta() {
  return useQuery({
    queryKey: financeQueryKeys.transactionsMeta(),
    queryFn: () => financeService.transactionsMeta(),
  });
}

export function useFinanceTransaction(uuid: string) {
  return useQuery({
    queryKey: financeQueryKeys.transaction(uuid),
    queryFn: () => financeService.getTransaction(uuid),
    enabled: Boolean(uuid),
  });
}

export type {
  FinanceAccount,
  FinanceCategory,
  FinanceSummary,
  FinanceTransaction,
  ListPage,
};
