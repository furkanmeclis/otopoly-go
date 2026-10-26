/** Reorder hooks (web `features/stock-reorder/hooks/use-stock-reorder.ts`). Keys live under `qk.stockReorder`. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { isFeatureDisabled } from '@/api/errors';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { MONEY_KEYS, qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

import { stockReorderService } from './services/stock-reorder.service';
import type { CreateReorderDraftsInput, PostDraftInput, ReorderListParams, ReorderOverrideInput, ReorderSettingsInput } from './types';

export const reorderKeys = {
  all: qk.stockReorder,
  list: (params: ReorderListParams) => [...qk.stockReorder, 'list', params] as const,
  summary: [...qk.stockReorder, 'summary'] as const,
  settings: [...qk.stockReorder, 'settings'] as const,
};

/** Read = purchases + catalog read; write = purchases write as owner (backend stockreorder routes.go). */
export function useReorderAccess() {
  const { can } = useAuth();
  const canRead = can(P.purchasesRead) && can(P.catalogRead);
  return { canRead, canWrite: canRead && can({ perm: P.purchasesWrite, owner: true }) };
}

const noPlanRetry = (count: number, error: unknown) => !isFeatureDisabled(error) && count < 2;

export const useReorderSuggestions = (params: ReorderListParams, enabled = true) =>
  useQuery({ queryKey: reorderKeys.list(params), queryFn: () => stockReorderService.list(params), enabled, placeholderData: keepPreviousData, retry: noPlanRetry });

/** Menu badge / plan probe (silent request; no retry when the plan turns the module off). */
export const useReorderSummary = (enabled = true) =>
  useQuery({ queryKey: reorderKeys.summary, queryFn: () => stockReorderService.summary(), enabled, staleTime: 60_000, retry: noPlanRetry });

export const useReorderSettings = (enabled = true) =>
  useQuery({ queryKey: reorderKeys.settings, queryFn: () => stockReorderService.settings(), enabled, retry: noPlanRetry });

export function useReorderMutations() {
  const { t: tr } = useLocale();
  const invalidate = [qk.stockReorder, qk.purchases];
  return {
    updateSettings: useApiMutation({
      key: 'stock_reorder.settings',
      fn: (body: ReorderSettingsInput) => stockReorderService.updateSettings(body),
      invalidate,
      success: tr('stock_reorder.toast.settings_saved'),
      toastValidation: true,
    }),
    setOverride: useApiMutation({
      key: 'stock_reorder.override',
      fn: ({ productUuid, body }: { productUuid: string; body: ReorderOverrideInput }) => stockReorderService.setProductOverride(productUuid, body),
      invalidate,
      success: tr('stock_reorder.toast.override_saved'),
      toastValidation: true,
    }),
    createDrafts: useApiMutation({
      key: 'stock_reorder.drafts',
      fn: (body: CreateReorderDraftsInput) => stockReorderService.createDrafts(body),
      invalidate,
      success: (data) => tr('stock_reorder.toast.drafts_created', { count: data.drafts.length }),
      toastValidation: true,
    }),
    postDraft: useApiMutation({
      key: 'stock_reorder.post_draft',
      fn: ({ uuid, body }: { uuid: string; body: PostDraftInput }) => stockReorderService.postDraft(uuid, body),
      invalidate: MONEY_KEYS,
      success: tr('stock_reorder.toast.draft_posted'),
      toastValidation: true,
    }),
    deleteDraft: useApiMutation({
      key: 'stock_reorder.delete_draft',
      fn: (uuid: string) => stockReorderService.deleteDraft(uuid),
      invalidate,
      success: tr('stock_reorder.toast.draft_deleted'),
    }),
  };
}
