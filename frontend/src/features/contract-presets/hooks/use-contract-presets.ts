"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  contractPresetsService,
  type CreatePresetInput,
  type PatchPresetInput,
} from "@/features/contract-presets/services/contract-presets.service";
import { useLocale } from "@/providers/locale-provider";

export const contractPresetKeys = {
  all: ["platform", "contract-presets"] as const,
  list: (params?: unknown) =>
    [...contractPresetKeys.all, "list", params] as const,
  detail: (uuid: string) =>
    [...contractPresetKeys.all, "detail", uuid] as const,
};

export function useContractPresets(
  params?: ServerListParams & { is_active?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: contractPresetKeys.list(params),
    queryFn: () => contractPresetsService.list(params),
    enabled: options?.enabled ?? true,
    retry: false,
  });
}

export function useContractPreset(uuid: string) {
  return useQuery({
    queryKey: contractPresetKeys.detail(uuid),
    queryFn: () => contractPresetsService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useContractPresetMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: contractPresetKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: CreatePresetInput) =>
        contractPresetsService.create(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.presets.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.presets.toast.failed")),
    }),
    update: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: PatchPresetInput;
      }) => contractPresetsService.update(uuid, body),
      onSuccess: (data) => {
        invalidate();
        queryClient.setQueryData(contractPresetKeys.detail(data.uuid), data);
        toast.success(t("contracts.presets.toast.updated"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.presets.toast.failed")),
    }),
    remove: useMutation({
      mutationFn: contractPresetsService.remove,
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.presets.toast.deleted"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.presets.toast.failed")),
    }),
  };
}
