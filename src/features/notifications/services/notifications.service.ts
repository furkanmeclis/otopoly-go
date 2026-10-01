import { request } from '@/api/client';
import type { components } from '@/api/generated/api';

import { parseSignedActionUrl } from '../deep-links';

type Schemas = components['schemas'];

export type AppNotification = Schemas['Notification'];
export type NotificationPage = Schemas['NotificationPage'];
export type UnreadCount = Schemas['UnreadCount'];
export type NotificationActionResult = Schemas['NotificationAction'];

export type InboxParams = {
  limit?: number;
  offset?: number;
  sort?: string;
  q?: string;
  status?: string;
  channel?: string;
  unread?: boolean;
};

/** In-app inbox (web `features/notifications/services/notifications.service.ts`). */
export const notificationsService = {
  list(params: InboxParams) {
    return request<NotificationPage>('GET', '/v1/notifications', { query: params });
  },
  unreadCount() {
    return request<UnreadCount>('GET', '/v1/notifications/unread-count', { silent: true });
  },
  get(uuid: string) {
    return request<AppNotification>('GET', `/v1/notifications/${uuid}`, { silent: true });
  },
  markRead(uuid: string) {
    return request<AppNotification>('POST', `/v1/notifications/${uuid}/read`, { silent: true });
  },
  markAllRead() {
    return request<{ status: string }>('POST', '/v1/notifications/read-all');
  },
  /** Self-test: enqueue a test notification to the signed-in user. */
  sendTest() {
    return request<{ items: AppNotification[] }>('POST', '/v1/notifications/test', { body: {} });
  },
  /**
   * Redeems the signed action (marks read server-side, returns the destination). A stale signature
   * is refreshed once from the notification itself, like the web.
   */
  async redeemSignedAction(source: { uuid?: string; signed_action_url?: string | null }) {
    try {
      const first = await redeem(source.signed_action_url);
      if (first) return first;
    } catch {
      // Expired or stale signature: fetch a fresh one below.
    }
    if (!source.uuid) return null;
    const full = await notificationsService.get(source.uuid);
    return redeem(full.signed_action_url);
  },
};

async function redeem(signed: string | null | undefined) {
  const parsed = parseSignedActionUrl(signed);
  if (!parsed) return null;
  return request<NotificationActionResult>('GET', `/v1/notifications/${parsed.uuid}/action`, {
    query: { exp: parsed.exp, sig: parsed.sig },
    silent: true,
  });
}
