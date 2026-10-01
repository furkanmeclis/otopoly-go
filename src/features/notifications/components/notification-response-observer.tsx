/**
 * Handles taps on push notifications, for both a cold start (the tap launched the app) and a warm
 * start (app in background). Mounted in the root layout once the session has been restored, so the
 * link screen can decide between sign-in, organization switch and navigation.
 *
 * Payload (backend `/v1/push-devices` doc): `{ title, body, data: { url?, notification_uuid, kind? } }`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';

import { session } from '@/api/session';
import { createLogger } from '@/lib/logger';

import { linkHref, toWebPath } from '../deep-links';
import { notificationsModule } from '../push';
import { notificationKeys } from '../queries';
import { notificationsService } from '../services/notifications.service';

const log = createLogger('notifications.tap');

// Foreground presentation: show the banner (the inbox badge refreshes via NotificationsHost).
notificationsModule()?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const handled = new Set<string>();

type TapData = { url?: unknown; notification_uuid?: unknown; kind?: unknown };

/** Where a tapped push should lead: its `data.url` through the link resolver, else the inbox. */
export function pushTapHref(data: TapData | null | undefined) {
  const web = typeof data?.url === 'string' ? toWebPath(data.url) : null;
  return web ? linkHref(web) : '/notifications';
}

export function NotificationResponseObserver() {
  const qc = useQueryClient();
  const navReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    const N = notificationsModule();
    if (!N || !navReady) return;

    const open = (response: import('expo-notifications').NotificationResponse) => {
      if (response.actionIdentifier !== N.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      if (handled.has(id)) return;
      handled.add(id);
      const data = (response.notification.request.content.data ?? {}) as TapData;
      log.info('Push tapped', { kind: data.kind, hasUrl: typeof data.url === 'string' });
      if (typeof data.notification_uuid === 'string' && session.get()) {
        notificationsService
          .markRead(data.notification_uuid)
          .then(() => qc.invalidateQueries({ queryKey: notificationKeys.all }))
          .catch(() => {});
      }
      router.push(pushTapHref(data) as never);
      N.clearLastNotificationResponse();
    };

    // Cold start: the tap that launched the app.
    const last = N.getLastNotificationResponse();
    if (last) open(last);

    const sub = N.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [navReady, qc]);

  return null;
}
