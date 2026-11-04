import { request } from '@/api/client';

/** `POST /v1/realtime/connection-token`: Centrifugo connection JWT for the signed-in user. */
export type ConnectionToken = { token: string; expires_at: string; ws_url: string };
/** `POST /v1/realtime/subscription-token`: JWT for one channel (403 without the resource's read permission). */
export type SubscriptionToken = { token: string; channel: string; expires_at: string };

// Silent: realtime is optional, a refusal (403 / 503 REALTIME_DISABLED) must never toast.
export const realtimeService = {
  connectionToken: () => request<ConnectionToken>('POST', '/v1/realtime/connection-token', { silent: true }),
  subscriptionToken: (channel: string) => request<SubscriptionToken>('POST', '/v1/realtime/subscription-token', { body: { channel }, silent: true }),
};
