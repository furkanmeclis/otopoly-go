/** Leads hooks beyond the shared `features/queries.ts` (web `features/leads/hooks/use-leads.ts`). */
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { leadsService } from '@/features/leads/services/leads.service';
import type { CreateLeadInput, LeadListParams, LeadTodoInput, PatchLeadInput } from '@/features/leads/types';
import { qk, useInfiniteList } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

type Params = Record<string, string | number | undefined>;

export const useLeadsInfinite = (params: LeadListParams, enabled = true) =>
  useInfiniteList([...qk.leads, 'infinite'], (p: Params) => leadsService.list(p as LeadListParams), params as Params, enabled);

/** Web `useLeadsAccess`. */
export function useLeadsAccess() {
  const { can } = useAuth();
  return {
    canRead: can(P.leadsRead),
    canWrite: can(P.leadsWrite),
    canTodo: can(P.leadsWrite) && can(P.todosWrite),
    canQuote: can(P.quotesWrite),
  };
}

export function useLeadMutations() {
  const { t } = useLocale();
  return {
    create: useApiMutation({
      key: 'leads.create',
      fn: (body: CreateLeadInput) => leadsService.create(body),
      invalidate: [qk.leads],
      success: t('leads.toast.created'),
    }),
    patch: useApiMutation({
      key: 'leads.update',
      fn: ({ uuid, body }: { uuid: string; body: PatchLeadInput }) => leadsService.patch(uuid, body),
      invalidate: [qk.leads],
      toastValidation: true,
    }),
    addNote: useApiMutation({
      key: 'leads.note',
      fn: ({ uuid, body }: { uuid: string; body: string }) => leadsService.addNote(uuid, body),
      invalidate: [qk.leads],
      toastValidation: true,
    }),
    createTodo: useApiMutation({
      key: 'leads.todo',
      fn: ({ uuid, body }: { uuid: string; body: LeadTodoInput }) => leadsService.createTodo(uuid, body),
      invalidate: [qk.leads, qk.todos],
      success: t('leads.toast.todo_created'),
    }),
    remove: useApiMutation({
      key: 'leads.delete',
      fn: (uuid: string) => leadsService.remove(uuid),
      invalidate: [qk.leads, qk.quotes],
      success: t('leads.toast.deleted'),
      toastValidation: true,
    }),
  };
}
