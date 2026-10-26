/** Calendar hooks (web `features/calendar/hooks/use-calendar.ts`). Keys live under `qk.calendar`. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isApiError } from '@/api/errors';
import { useApiErrorMessage, useToast } from '@/components/feedback/toast';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

import { placeItem } from './lib/feed';
import { calendarService } from './services/calendar.service';
import type { CalendarEventInput, CalendarFeed, CalendarFeedItem, CalendarMoveInput } from './types';

export const calendarKeys = {
  all: qk.calendar,
  meta: [...qk.calendar, 'meta'] as const,
  feeds: [...qk.calendar, 'feed'] as const,
  feed: (from: string, to: string, layers: string) => [...qk.calendar, 'feed', from, to, layers] as const,
  event: (uuid: string) => [...qk.calendar, 'event', uuid] as const,
};

/** Layers this member may see / move, colours, business time zone. */
export const useCalendarMeta = (enabled = true) =>
  useQuery({ queryKey: calendarKeys.meta, queryFn: () => calendarService.meta(), enabled, staleTime: 5 * 60_000 });

/** Feed for `[from, to)`; no request while every layer is hidden. */
export function useCalendarFeed(from: string, to: string, layers: readonly string[], enabled = true) {
  const key = [...layers].sort().join(',');
  return useQuery({
    queryKey: calendarKeys.feed(from, to, key),
    queryFn: () => calendarService.feed({ from, to, layers: key }),
    enabled: enabled && layers.length > 0,
    placeholderData: keepPreviousData,
  });
}

export const useCalendarEvent = (uuid: string | null | undefined) =>
  useQuery({ queryKey: calendarKeys.event(uuid ?? ''), queryFn: () => calendarService.getEvent(uuid!), enabled: Boolean(uuid), retry: false });

export function useCalendarMutations() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const invalidate = [calendarKeys.all];
  return {
    create: useApiMutation({
      key: 'calendar.create',
      fn: (body: CalendarEventInput) => calendarService.createEvent(body),
      invalidate,
      success: t('calendar.event.saved'),
    }),
    update: useApiMutation({
      key: 'calendar.update',
      fn: ({ uuid, body }: { uuid: string; body: CalendarEventInput }) => calendarService.updateEvent(uuid, body),
      invalidate,
      success: t('calendar.event.saved'),
    }),
    remove: useApiMutation({
      key: 'calendar.delete',
      fn: (uuid: string) => calendarService.deleteEvent(uuid),
      invalidate,
      success: t('calendar.event.deleted'),
      toastValidation: true,
    }),
    /** Reschedules an event / todo / lead; the item jumps to its new day at once and rolls back on error. */
    move: useMutation({
      mutationKey: ['calendar.move'],
      mutationFn: ({ body }: { item: CalendarFeedItem; body: CalendarMoveInput }) => calendarService.move(body),
      onMutate: async ({ item, body }) => {
        await qc.cancelQueries({ queryKey: calendarKeys.feeds });
        const snapshot = qc.getQueriesData<CalendarFeed>({ queryKey: calendarKeys.feeds });
        qc.setQueriesData<CalendarFeed>({ queryKey: calendarKeys.feeds }, (feed) =>
          feed ? { ...feed, items: feed.items.map((i) => (i.id === item.id ? placeItem(i, body) : i)) } : feed,
        );
        return { snapshot };
      },
      onError: (error, _vars, ctx) => {
        for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
        if (isApiError(error) && (error.isNetwork || error.status >= 500)) return;
        toast.error(t('common.error_generic'), toMessage(error));
      },
      onSuccess: () => toast.success(t('calendar.moved')),
      onSettled: (_data, _error, { body }) => {
        void qc.invalidateQueries({ queryKey: calendarKeys.all });
        // Todos / leads changed in their own modules too.
        if (body.layer === 'todos') void qc.invalidateQueries({ queryKey: qk.todos });
        if (body.layer === 'leads') void qc.invalidateQueries({ queryKey: qk.leads });
      },
    }),
  };
}
