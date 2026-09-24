"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import { todosService } from "@/features/todos/services/todos.service";
import type {
  CreateTodoInput,
  PatchTodoInput,
  TodoListParams,
} from "@/features/todos/types";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const todosKeys = {
  all: ["tenant", "todos"] as const,
  list: (params?: TodoListParams) =>
    [...todosKeys.all, "list", params] as const,
  summary: () => [...todosKeys.all, "summary"] as const,
  assignees: () => [...todosKeys.all, "assignees"] as const,
};

export function useTodosAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.todos.read),
    canWrite: hasPermission(permissions.todos.write),
  };
}

export function useTodos(params: TodoListParams, enabled = true) {
  return useQuery({
    queryKey: todosKeys.list(params),
    queryFn: () => todosService.list(params),
    enabled,
  });
}

export function useTodoSummary(enabled = true) {
  return useQuery({
    queryKey: todosKeys.summary(),
    queryFn: () => todosService.summary(),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useTodoAssignees(enabled = true) {
  return useQuery({
    queryKey: todosKeys.assignees(),
    queryFn: () => todosService.assignees(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useTodoMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const invalidate = () => qc.invalidateQueries({ queryKey: todosKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: CreateTodoInput) => todosService.create(body),
      onSuccess: () => {
        toast.success(t("todos.toast.created"));
        return invalidate();
      },
    }),
    patch: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: PatchTodoInput }) =>
        todosService.patch(uuid, body),
      onSuccess: () => {
        toast.success(t("todos.toast.updated"));
        return invalidate();
      },
    }),
    toggle: useMutation({
      mutationFn: ({ uuid, done }: { uuid: string; done: boolean }) =>
        done ? todosService.complete(uuid) : todosService.reopen(uuid),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (uuid: string) => todosService.remove(uuid),
      onSuccess: () => {
        toast.success(t("todos.toast.deleted"));
        return invalidate();
      },
    }),
  };
}
