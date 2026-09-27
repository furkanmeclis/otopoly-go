"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  jobsService,
  type CloseJobInput,
  type CreateJobInput,
} from "@/features/jobs/services/jobs.service";
import { useLocale } from "@/providers/locale-provider";

export const jobsKeys = {
  all: ["tenant", "jobs"] as const,
  summary: (date?: string) => [...jobsKeys.all, "summary", date] as const,
  meta: () => [...jobsKeys.all, "meta"] as const,
  list: (params?: unknown) => [...jobsKeys.all, "list", params] as const,
  detail: (uuid: string) => [...jobsKeys.all, "detail", uuid] as const,
  byCustomer: (customerUuid: string, params?: unknown) =>
    [...jobsKeys.all, "customer", customerUuid, params] as const,
};

export function useJobsSummary(date?: string) {
  return useQuery({
    queryKey: jobsKeys.summary(date),
    queryFn: () => jobsService.summary(date),
  });
}

export function useJobsMeta() {
  return useQuery({
    queryKey: jobsKeys.meta(),
    queryFn: () => jobsService.meta(),
  });
}

export function useJobs(
  params?: ServerListParams & {
    status?: string;
    date_from?: string;
    date_to?: string;
  },
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: jobsKeys.list(params),
    queryFn: () => jobsService.list(params),
    refetchInterval: options?.refetchInterval,
  });
}

export function useJob(uuid: string) {
  return useQuery({
    queryKey: jobsKeys.detail(uuid),
    queryFn: () => jobsService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCustomerJobs(
  customerUuid: string,
  params?: ServerListParams,
) {
  return useQuery({
    queryKey: jobsKeys.byCustomer(customerUuid, params),
    queryFn: () => jobsService.listByCustomer(customerUuid, params),
    enabled: Boolean(customerUuid),
  });
}

export function useJobsMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: jobsKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: CreateJobInput) => jobsService.create(body),
      onSuccess: (data) => {
        invalidate();
        toast.success(t("jobs.toast.created"), {
          id: `job-created-${data.uuid}`,
        });
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    patch: useMutation({
      mutationFn: ({
        uuid,
        notes,
        assignee_uuid,
      }: {
        uuid: string;
        notes?: string;
        assignee_uuid?: string | null;
      }) => jobsService.patch(uuid, { notes, assignee_uuid }),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: jobsKeys.detail(data.uuid),
        });
        toast.success(t("jobs.toast.updated"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    done: useMutation({
      mutationFn: (uuid: string) => jobsService.ready(uuid),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: jobsKeys.detail(data.uuid),
        });
        toast.success(t("jobs.toast.ready"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    deliver: useMutation({
      mutationFn: (uuid: string) => jobsService.deliver(uuid),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: jobsKeys.detail(data.uuid),
        });
        toast.success(t("jobs.toast.delivered"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    consumption: useMutation({
      mutationFn: (
        input:
          | { op: "add"; uuid: string; product_uuid: string; qty: string }
          | { op: "update"; uuid: string; consumptionUuid: string; qty: string }
          | { op: "delete"; uuid: string; consumptionUuid: string },
      ) => {
        if (input.op === "add")
          return jobsService.addConsumption(input.uuid, {
            product_uuid: input.product_uuid,
            qty: input.qty,
          });
        if (input.op === "update")
          return jobsService.updateConsumption(
            input.uuid,
            input.consumptionUuid,
            input.qty,
          );
        return jobsService.deleteConsumption(input.uuid, input.consumptionUuid);
      },
      onSuccess: (data) => {
        queryClient.setQueryData(jobsKeys.detail(data.uuid), data);
        // Stock levels changed.
        void queryClient.invalidateQueries({ queryKey: ["tenant", "catalog"] });
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    close: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: CloseJobInput }) =>
        jobsService.close(uuid, body),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: jobsKeys.detail(data.uuid),
        });
        toast.success(t("jobs.toast.closed"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    cancel: useMutation({
      mutationFn: (uuid: string) => jobsService.cancel(uuid),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: jobsKeys.detail(data.uuid),
        });
        toast.success(t("jobs.toast.cancelled"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
    voidJob: useMutation({
      mutationFn: (uuid: string) => jobsService.void(uuid),
      onSuccess: (data) => {
        invalidate();
        void queryClient.invalidateQueries({
          queryKey: jobsKeys.detail(data.uuid),
        });
        toast.success(t("jobs.toast.voided"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("jobs.toast.failed")),
    }),
  };
}
