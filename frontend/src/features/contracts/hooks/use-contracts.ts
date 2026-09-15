"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  contractsService,
  type CloneTemplateInput,
  type CreateInstanceInput,
  type CreateTemplateInput,
  type PatchTemplateInput,
  type SignInput,
} from "@/features/contracts/services/contracts.service";
import { useLocale } from "@/providers/locale-provider";

export const contractKeys = {
  all: ["tenant", "contracts"] as const,
  templates: (params?: unknown) =>
    [...contractKeys.all, "templates", params] as const,
  template: (uuid: string) =>
    [...contractKeys.all, "template", uuid] as const,
  instances: (params?: unknown) =>
    [...contractKeys.all, "instances", params] as const,
  instance: (uuid: string) =>
    [...contractKeys.all, "instance", uuid] as const,
};

export function useContractTemplates(
  params?: ServerListParams & { is_active?: string },
) {
  return useQuery({
    queryKey: contractKeys.templates(params),
    queryFn: () => contractsService.listTemplates(params),
  });
}

export function useContractTemplate(uuid: string) {
  return useQuery({
    queryKey: contractKeys.template(uuid),
    queryFn: () => contractsService.getTemplate(uuid),
    enabled: Boolean(uuid),
  });
}

export function useContractInstances(
  params?: ServerListParams & {
    status?: string;
    subject_type?: string;
    subject_uuid?: string;
  },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: contractKeys.instances(params),
    queryFn: () => contractsService.listInstances(params),
    enabled: options?.enabled ?? true,
  });
}

export function useContractInstance(uuid: string) {
  return useQuery({
    queryKey: contractKeys.instance(uuid),
    queryFn: () => contractsService.getInstance(uuid),
    enabled: Boolean(uuid),
  });
}

export function useContractMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: contractKeys.all });

  return {
    createTemplate: useMutation({
      mutationFn: (body: CreateTemplateInput) =>
        contractsService.createTemplate(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.templates.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.templates.toast.failed")),
    }),
    cloneTemplate: useMutation({
      mutationFn: (body: CloneTemplateInput) =>
        contractsService.cloneTemplate(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.templates.toast.cloned"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.templates.toast.failed")),
    }),
    updateTemplate: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: PatchTemplateInput;
      }) => contractsService.updateTemplate(uuid, body),
      onSuccess: (data) => {
        invalidate();
        queryClient.setQueryData(contractKeys.template(data.uuid), data);
        toast.success(t("contracts.templates.toast.updated"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.templates.toast.failed")),
    }),
    removeTemplate: useMutation({
      mutationFn: contractsService.removeTemplate,
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.templates.toast.deleted"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.templates.toast.failed")),
    }),
    createInstance: useMutation({
      mutationFn: (body: CreateInstanceInput) =>
        contractsService.createInstance(body),
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.instances.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.instances.toast.failed")),
    }),
    voidInstance: useMutation({
      mutationFn: contractsService.voidInstance,
      onSuccess: (data) => {
        invalidate();
        queryClient.setQueryData(contractKeys.instance(data.uuid), data);
        toast.success(t("contracts.instances.toast.voided"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.instances.toast.failed")),
    }),
    sign: useMutation({
      mutationFn: ({
        instanceUuid,
        signerUuid,
        body,
      }: {
        instanceUuid: string;
        signerUuid: string;
        body: SignInput;
      }) => contractsService.sign(instanceUuid, signerUuid, body),
      onSuccess: (data) => {
        invalidate();
        queryClient.setQueryData(contractKeys.instance(data.uuid), data);
        toast.success(t("contracts.instances.toast.signed"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.instances.toast.failed")),
    }),
    uploadMedia: useMutation({
      mutationFn: ({
        instanceUuid,
        file,
        caption,
      }: {
        instanceUuid: string;
        file: File;
        caption?: string;
      }) => contractsService.uploadMedia(instanceUuid, file, caption),
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.instances.toast.media"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.instances.toast.failed")),
    }),
    deleteMedia: useMutation({
      mutationFn: ({
        instanceUuid,
        mediaUuid,
      }: {
        instanceUuid: string;
        mediaUuid: string;
      }) => contractsService.deleteMedia(instanceUuid, mediaUuid),
      onSuccess: () => {
        invalidate();
        toast.success(t("contracts.instances.toast.media_deleted"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("contracts.instances.toast.failed")),
    }),
  };
}
