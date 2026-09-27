"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  staffService,
  type CreateStaffInput,
} from "@/features/staff/services/staff.service";
import { useLocale } from "@/providers/locale-provider";

export const staffKeys = {
  all: ["tenant", "staff"] as const,
  list: () => [...staffKeys.all, "list"] as const,
  options: () => [...staffKeys.all, "options"] as const,
  meta: () => [...staffKeys.all, "meta"] as const,
};

export function useStaff() {
  return useQuery({
    queryKey: staffKeys.list(),
    queryFn: () => staffService.list(),
  });
}

export function useStaffOptions(enabled = true) {
  return useQuery({
    queryKey: staffKeys.options(),
    queryFn: () => staffService.options(),
    enabled,
  });
}

export function useStaffMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: staffKeys.all });

  return {
    create: useMutation({
      mutationFn: (body: CreateStaffInput) => staffService.create(body),
      onSuccess: () => {
        invalidate();
        void queryClient.invalidateQueries({ queryKey: ["tenant", "billing"] });
        toast.success(t("staff.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("staff.toast.failed")),
    }),
    patch: useMutation({
      mutationFn: ({
        uuid,
        status,
      }: {
        uuid: string;
        status: "active" | "inactive";
      }) => staffService.patch(uuid, { status }),
      onSuccess: () => {
        invalidate();
        toast.success(t("staff.toast.updated"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("staff.toast.failed")),
    }),
    resetPassword: useMutation({
      mutationFn: ({
        uuid,
        password,
      }: {
        uuid: string;
        password: string;
      }) => staffService.resetPassword(uuid, { password }),
      onSuccess: () => {
        toast.success(t("staff.toast.password_reset"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("staff.toast.failed")),
    }),
  };
}
