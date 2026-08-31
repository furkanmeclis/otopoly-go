"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { financeQueryKeys } from "@/features/finance/hooks/query-keys";
import { financeService } from "@/features/finance/services/finance.service";

export function useFinanceMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: financeQueryKeys.all });
  };

  const createAccount = useMutation({
    mutationFn: financeService.createAccount,
    onSuccess: invalidate,
  });
  const patchAccount = useMutation({
    mutationFn: ({
      uuid,
      body,
    }: {
      uuid: string;
      body: Record<string, unknown>;
    }) => financeService.patchAccount(uuid, body),
    onSuccess: invalidate,
  });
  const deleteAccount = useMutation({
    mutationFn: financeService.deleteAccount,
    onSuccess: invalidate,
  });
  const createCategory = useMutation({
    mutationFn: financeService.createCategory,
    onSuccess: invalidate,
  });
  // TODO(finance): patchCategory, deleteCategory mutations + wire category edit/deactivate UI.
  const createTransaction = useMutation({
    mutationFn: financeService.createTransaction,
    onSuccess: invalidate,
  });
  const voidTransaction = useMutation({
    mutationFn: financeService.voidTransaction,
    onSuccess: invalidate,
  });
  const createTransfer = useMutation({
    mutationFn: financeService.createTransfer,
    onSuccess: invalidate,
  });

  return {
    createAccount,
    patchAccount,
    deleteAccount,
    createCategory,
    createTransaction,
    voidTransaction,
    createTransfer,
  };
}
