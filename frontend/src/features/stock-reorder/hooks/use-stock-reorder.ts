"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import { purchasesKeys } from "@/features/purchases/hooks/use-purchases";
import {
  stockReorderService,
  type CreateReorderDraftsInput,
  type PostDraftInput,
  type ReorderListParams,
  type ReorderOverrideInput,
  type ReorderSettingsInput,
} from "@/features/stock-reorder/services/stock-reorder.service";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const stockReorderKeys = {
  all: ["tenant", "stock-reorder"] as const,
  list: (params?: unknown) =>
    [...stockReorderKeys.all, "list", params] as const,
  summary: () => [...stockReorderKeys.all, "summary"] as const,
  preview: () => [...stockReorderKeys.all, "preview"] as const,
  settings: () => [...stockReorderKeys.all, "settings"] as const,
  override: (uuid: string) =>
    [...stockReorderKeys.all, "override", uuid] as const,
};

/** Read: purchases + catalog read. Write: purchases write and owner (like purchases). */
export function useStockReorderAccess(slug: string) {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = user?.organizations.find((org) => org.slug === slug);
  const isOwner = membership?.role === "owner";
  const canRead =
    hasPermission(permissions.purchases.read) &&
    hasPermission(permissions.catalog.read);
  const canWrite =
    canRead && isOwner && hasPermission(permissions.purchases.write);
  return { canRead, canWrite, isOwner };
}

const noRetryOnPlan = (count: number, error: unknown) =>
  !isFeatureDisabledError(error) && count < 2;

export function useReorderSuggestions(
  params: ReorderListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: stockReorderKeys.list(params),
    queryFn: () => stockReorderService.list(params),
    enabled,
    retry: noRetryOnPlan,
  });
}

export function useReorderSummary(enabled = true) {
  return useQuery({
    queryKey: stockReorderKeys.summary(),
    queryFn: () => stockReorderService.summary(),
    enabled,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useReorderPreview(enabled = true) {
  return useQuery({
    queryKey: stockReorderKeys.preview(),
    queryFn: () => stockReorderService.urgentPreview(),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useReorderSettings(enabled = true) {
  return useQuery({
    queryKey: stockReorderKeys.settings(),
    queryFn: () => stockReorderService.settings(),
    enabled,
    retry: noRetryOnPlan,
  });
}

export function useReorderOverride(productUuid: string, enabled = true) {
  return useQuery({
    queryKey: stockReorderKeys.override(productUuid),
    queryFn: () => stockReorderService.productOverride(productUuid),
    enabled: enabled && Boolean(productUuid),
  });
}

export function useStockReorderMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: stockReorderKeys.all });
    void queryClient.invalidateQueries({ queryKey: purchasesKeys.all });
  };
  const onError = (err: Error) =>
    toast.error(err.message || t("stock_reorder.toast.failed"));

  return {
    updateSettings: useMutation({
      mutationFn: (body: ReorderSettingsInput) =>
        stockReorderService.updateSettings(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("stock_reorder.toast.settings_saved"));
      },
      onError,
    }),
    setOverride: useMutation({
      mutationFn: ({
        productUuid,
        body,
      }: {
        productUuid: string;
        body: ReorderOverrideInput;
      }) => stockReorderService.setProductOverride(productUuid, body),
      onSuccess: () => {
        invalidate();
        toast.success(t("stock_reorder.toast.override_saved"));
      },
      onError,
    }),
    createDrafts: useMutation({
      mutationFn: (body: CreateReorderDraftsInput) =>
        stockReorderService.createDrafts(body),
      onSuccess: (data) => {
        invalidate();
        toast.success(
          t("stock_reorder.toast.drafts_created", {
            count: data.drafts.length,
          }),
        );
      },
      onError,
    }),
    postDraft: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: PostDraftInput }) =>
        stockReorderService.postDraft(uuid, body),
      onSuccess: () => {
        invalidate();
        toast.success(t("stock_reorder.toast.draft_posted"));
      },
      onError,
    }),
    deleteDraft: useMutation({
      mutationFn: (uuid: string) => stockReorderService.deleteDraft(uuid),
      onSuccess: () => {
        invalidate();
        toast.success(t("stock_reorder.toast.draft_deleted"));
      },
      onError,
    }),
  };
}
