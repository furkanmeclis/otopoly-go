/** Inbox hooks: unread badge, infinite list, read / read-all. */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useInfiniteList } from '@/features/queries';
import { useApiMutation } from '@/lib/mutation';

import { notificationsService, type InboxParams } from './services/notifications.service';

export const notificationKeys = {
  all: ['notifications'] as const,
  unread: ['notifications', 'unread-count'] as const,
  inbox: ['notifications', 'inbox'] as const,
};

/** Unread in-app count for the bell. Polls while mounted; push / foreground also invalidate it. */
export const useUnreadCount = (enabled = true) =>
  useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await notificationsService.unreadCount()).count,
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

/** In-app inbox pages (`unread: 'true'` for the unread filter). */
export const useInboxInfinite = (params: { unread?: 'true'; q?: string }, enabled = true) =>
  useInfiniteList(notificationKeys.inbox, (p) => notificationsService.list({ ...(p as InboxParams), channel: 'inapp' }), params, enabled);

export function useNotificationMutations() {
  const qc = useQueryClient();
  const markRead = useApiMutation({
    key: 'notifications.read',
    fn: (uuid: string) => notificationsService.markRead(uuid),
    invalidate: [notificationKeys.all],
  });
  const markAllRead = useApiMutation({
    key: 'notifications.read_all',
    fn: () => notificationsService.markAllRead(),
    invalidate: [notificationKeys.all],
  });
  const refresh = () => qc.invalidateQueries({ queryKey: notificationKeys.all });
  return { markRead, markAllRead, refresh };
}
