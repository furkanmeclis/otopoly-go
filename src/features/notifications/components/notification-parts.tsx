import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Bell, CalendarClock, FileText, Gauge } from 'lucide-react-native';
import { useCallback } from 'react';
import { Linking } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { IconButton } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { canMarkNotificationRead, linkHref, notificationTarget, type NotificationActionTarget } from '../deep-links';
import { notificationKeys, useUnreadCount } from '../queries';
import { notificationsService, type AppNotification } from '../services/notifications.service';

const log = createLogger('notifications');

/** Header bell with the unread badge; opens the inbox. */
export function NotificationBell() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const enabled = can(P.notificationsRead);
  const unread = useUnreadCount(enabled);
  if (!enabled) return null;
  const count = unread.data ?? 0;
  return (
    <IconButton
      label={count ? tr('notifications.inbox.trigger_unread', { count }) : tr('notifications.inbox.trigger')}
      icon={<Bell size={20} color={t.colors.text} />}
      badge={count}
      onPress={() => router.push('/notifications')}
    />
  );
}

/** Icon per notification kind (`template_code`). */
export function NotificationKindIcon({ kind, color, size = 18 }: { kind?: string; color: string; size?: number }) {
  if (kind?.startsWith('quote.')) return <FileText size={size} color={color} />;
  if (kind === 'todo.reminder') return <CalendarClock size={size} color={color} />;
  if (kind?.startsWith('billing.')) return <Gauge size={size} color={color} />;
  return <Bell size={size} color={color} />;
}

export function navigateTo(target: NotificationActionTarget) {
  if (target.kind === 'web') router.push(linkHref(target.path) as Href);
  else if (target.kind === 'app') router.push(target.href as Href);
  else void Linking.openURL(target.url);
}

/**
 * Opens a notification like the web inbox: redeem the signed action (marks it read server-side),
 * fall back to `POST …/read`, then navigate to its destination if it has one.
 */
export function useOpenNotification() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t: tr } = useLocale();
  const { organization } = useAuth();
  const activeSlug = organization?.slug ?? null;

  const targetOf = useCallback((n: AppNotification) => notificationTarget(n.action_url, { activeSlug, payload: n.payload }), [activeSlug]);

  const open = useCallback(
    async (n: AppNotification) => {
      const target = targetOf(n);
      try {
        if (target && n.signed_action_url) {
          await notificationsService.redeemSignedAction(n);
        } else if (canMarkNotificationRead(n)) {
          await notificationsService.markRead(n.uuid);
        }
      } catch (error) {
        log.warn('Marking notification read failed', error);
        if (target) toast.error(tr('notifications.toast.action_failed'));
      } finally {
        void qc.invalidateQueries({ queryKey: notificationKeys.all });
      }
      if (target) navigateTo(target);
    },
    [qc, targetOf, toast, tr],
  );

  return { open, targetOf };
}
