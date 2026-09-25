"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import { leadsService } from "@/features/leads/services/leads.service";
import type {
  CreateLeadInput,
  LeadListParams,
  LeadTodoInput,
  PatchLeadInput,
} from "@/features/leads/types";
import { todosKeys } from "@/features/todos/hooks/use-todos";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const leadsKeys = {
  all: ["tenant", "leads"] as const,
  list: (params?: LeadListParams) =>
    [...leadsKeys.all, "list", params] as const,
  summary: () => [...leadsKeys.all, "summary"] as const,
  assignees: () => [...leadsKeys.all, "assignees"] as const,
  detail: (uuid: string) => [...leadsKeys.all, "detail", uuid] as const,
};

export function useLeadsAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.leads.read),
    canWrite: hasPermission(permissions.leads.write),
    canTodo:
      hasPermission(permissions.leads.write) &&
      hasPermission(permissions.todos.write),
    canQuote: hasPermission(permissions.quotes.write),
  };
}

export function useLeads(params: LeadListParams, enabled = true) {
  return useQuery({
    queryKey: leadsKeys.list(params),
    queryFn: () => leadsService.list(params),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useLeadSummary(enabled = true) {
  return useQuery({
    queryKey: leadsKeys.summary(),
    queryFn: () => leadsService.summary(),
    enabled,
    refetchInterval: 120_000,
  });
}

export function useLeadAssignees(enabled = true) {
  return useQuery({
    queryKey: leadsKeys.assignees(),
    queryFn: () => leadsService.assignees(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useLead(uuid: string) {
  return useQuery({
    queryKey: leadsKeys.detail(uuid),
    queryFn: () => leadsService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useLeadMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => qc.invalidateQueries({ queryKey: leadsKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: CreateLeadInput) => leadsService.create(body),
      onSuccess: () => {
        toast.success(t("leads.toast.created"));
        return invalidate();
      },
    }),
    patch: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: PatchLeadInput }) =>
        leadsService.patch(uuid, body),
      onSuccess: (lead) => {
        qc.setQueryData(leadsKeys.detail(lead.uuid), lead);
        return invalidate();
      },
    }),
    addNote: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: string }) =>
        leadsService.addNote(uuid, body),
      onSuccess: (lead) => {
        qc.setQueryData(leadsKeys.detail(lead.uuid), lead);
      },
    }),
    createTodo: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: LeadTodoInput }) =>
        leadsService.createTodo(uuid, body),
      onSuccess: (res) => {
        toast.success(t("leads.toast.todo_created"));
        qc.setQueryData(leadsKeys.detail(res.lead.uuid), res.lead);
        void qc.invalidateQueries({ queryKey: todosKeys.all });
      },
    }),
    remove: useMutation({
      mutationFn: (uuid: string) => leadsService.remove(uuid),
      onSuccess: () => {
        toast.success(t("leads.toast.deleted"));
        return invalidate();
      },
    }),
  };
}
