/** Quotes hooks beyond the shared `features/queries.ts` (web `features/quotes/hooks/use-quotes.ts`). */
import { useQuery } from '@tanstack/react-query';

import { useToast } from '@/components/feedback/toast';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { MONEY_KEYS, qk, useInfiniteList } from '@/features/queries';
import { deliveryErrorText } from '@/features/quotes/lib/quote-ui';
import { quotesService } from '@/features/quotes/services/quotes.service';
import type { ConvertQuoteInput, QuoteListParams, QuoteReminderInput, QuoteSendResult, SaveQuoteInput, SendQuoteInput } from '@/features/quotes/types';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

type Params = Record<string, string | number | undefined>;

export const useQuotesInfinite = (params: QuoteListParams, enabled = true) =>
  useInfiniteList([...qk.quotes, 'infinite'], (p: Params) => quotesService.list(p as QuoteListParams), params as Params, enabled);

export const useQuoteSendPreview = (uuid: string, enabled: boolean) =>
  useQuery({ queryKey: [...qk.quotes, 'send-preview', uuid], queryFn: () => quotesService.sendPreview(uuid), enabled: enabled && Boolean(uuid), retry: false, staleTime: 30_000 });

/** Web `useQuotesAccess`: converting also needs jobs write. */
export function useQuotesAccess() {
  const { can } = useAuth();
  return { canRead: can(P.quotesRead), canWrite: can(P.quotesWrite), canConvert: can(P.quotesWrite) && can(P.jobsWrite) };
}

export function useQuoteMutations() {
  const { t } = useLocale();
  const toast = useToast();
  const invalidate = [qk.quotes, qk.leads, qk.todos];
  const deliveryToast = (res: QuoteSendResult) => {
    if (res.delivery.status === 'sent') toast.success(t('quotes.toast.sent'));
    else toast.show('warning', t('quotes.toast.send_failed'), deliveryErrorText(res.delivery.error, t));
  };
  return {
    create: useApiMutation({ key: 'quotes.create', fn: (body: SaveQuoteInput) => quotesService.create(body), invalidate, success: (q) => t('quotes.toast.created', { number: q.number }) }),
    update: useApiMutation({
      key: 'quotes.update',
      fn: ({ uuid, body }: { uuid: string; body: SaveQuoteInput }) => quotesService.update(uuid, body),
      invalidate,
      success: t('quotes.toast.saved'),
    }),
    duplicate: useApiMutation({ key: 'quotes.duplicate', fn: (uuid: string) => quotesService.duplicate(uuid), invalidate, success: (q) => t('quotes.toast.created', { number: q.number }), toastValidation: true }),
    setStatus: useApiMutation({
      key: 'quotes.status',
      fn: ({ uuid, status, note }: { uuid: string; status: string; note?: string }) => quotesService.setStatus(uuid, status, note),
      invalidate,
      success: (q) => t('quotes.toast.status', { status: t(`quotes.status.${q.status}`) }),
      toastValidation: true,
    }),
    send: useApiMutation({
      key: 'quotes.send',
      fn: ({ uuid, body }: { uuid: string; body: SendQuoteInput }) => quotesService.send(uuid, body),
      invalidate,
      onSuccess: deliveryToast,
      toastValidation: true,
    }),
    retry: useApiMutation({
      key: 'quotes.delivery.retry',
      fn: ({ uuid, deliveryUuid }: { uuid: string; deliveryUuid: string }) => quotesService.retryDelivery(uuid, deliveryUuid),
      invalidate,
      onSuccess: deliveryToast,
      toastValidation: true,
    }),
    setReminders: useApiMutation({
      key: 'quotes.reminders',
      fn: ({ uuid, reminders }: { uuid: string; reminders: QuoteReminderInput[] }) => quotesService.setReminders(uuid, reminders),
      invalidate,
      success: t('quotes.toast.reminders'),
      toastValidation: true,
    }),
    convert: useApiMutation({
      key: 'quotes.convert',
      fn: ({ uuid, body }: { uuid: string; body: ConvertQuoteInput }) => quotesService.convert(uuid, body),
      invalidate: [...invalidate, ...MONEY_KEYS],
      success: t('quotes.toast.converted'),
    }),
  };
}
