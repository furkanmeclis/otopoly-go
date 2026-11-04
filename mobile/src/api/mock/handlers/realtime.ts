/**
 * Realtime tokens (`/v1/realtime/*`). The demo never opens a socket (lib/realtime/mock-driver.ts), but the
 * tokens follow the backend rules so the app's fail-soft paths run in demo mode too.
 */
import { LIVE_TARGETS } from '@/lib/realtime/live-targets';

import { fail, requireFields, route, str } from '../core';

const TTL_MS = 15 * 60_000;
const expires = () => new Date(Date.now() + TTL_MS).toISOString();
const ORG_CHANNEL = /^org:([0-9a-fA-F-]+):resource:([a-z0-9._-]+)$/;

route('POST', '/v1/realtime/connection-token', (ctx) => ({
  token: `mock-rt-conn.${ctx.user!.uuid}.${Math.random().toString(36).slice(2, 10)}`,
  expires_at: expires(),
  ws_url: 'wss://mock.otopoly.app/connection/websocket',
}));

route('POST', '/v1/realtime/subscription-token', (ctx) => {
  requireFields(ctx.body, ['channel']);
  const channel = str(ctx.body.channel);
  if (channel !== `user:${ctx.user!.uuid}`) {
    const m = ORG_CHANNEL.exec(channel);
    if (!m) fail(403, 'FORBIDDEN', 'Channel not allowed');
    const [, org, resource] = m!;
    if (!ctx.orgUuid || ctx.orgUuid !== org) fail(403, 'FORBIDDEN', 'Organization context mismatch');
    const target = LIVE_TARGETS[resource as keyof typeof LIVE_TARGETS];
    if (!target) fail(403, 'FORBIDDEN', 'Unknown live resource');
    if (!ctx.permissions.has(target.perm)) fail(403, 'FORBIDDEN', `Missing permission ${target.perm}`);
  }
  return { token: `mock-rt-sub.${Math.random().toString(36).slice(2, 10)}`, channel, expires_at: expires() };
});
