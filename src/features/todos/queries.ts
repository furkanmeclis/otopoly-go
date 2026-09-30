/** Todos hooks beyond the shared `features/queries.ts` (web `features/todos/hooks/use-todos.ts`). */
import { useQuery } from '@tanstack/react-query';

import { qk, useInfiniteList } from '@/features/queries';
import { todosService } from '@/features/todos/services/todos.service';
import type { CreateTodoInput, PatchTodoInput, TodoListParams } from '@/features/todos/types';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

type Params = Record<string, string | number | undefined>;

/** Paged todo list. Own key segment so it never shares cache with the plain `useTodos` list. */
export const useTodosInfinite = (params: TodoListParams, enabled = true) =>
  useInfiniteList([...qk.todos, 'infinite'], (p: Params) => todosService.list(p as TodoListParams), params as Params, enabled);

/** Single todo (deep link from reminder notifications: `/todos?todo={uuid}`). */
export const useTodo = (uuid: string | undefined) =>
  useQuery({ queryKey: [...qk.todos, 'detail', uuid], queryFn: () => todosService.get(uuid!), enabled: Boolean(uuid), retry: false });

export function useTodoMutations() {
  const { t } = useLocale();
  // Lead / quote detail pages show linked todos and the lead timeline records todo creation.
  const invalidate = [qk.todos, qk.leads, qk.quotes];
  return {
    create: useApiMutation({
      key: 'todos.create',
      fn: (body: CreateTodoInput) => todosService.create(body),
      invalidate,
      success: t('todos.toast.created'),
    }),
    patch: useApiMutation({
      key: 'todos.update',
      fn: ({ uuid, body }: { uuid: string; body: PatchTodoInput }) => todosService.patch(uuid, body),
      invalidate,
      success: t('todos.toast.updated'),
    }),
    remove: useApiMutation({
      key: 'todos.delete',
      fn: (uuid: string) => todosService.remove(uuid),
      invalidate,
      success: t('todos.toast.deleted'),
      toastValidation: true,
    }),
  };
}
