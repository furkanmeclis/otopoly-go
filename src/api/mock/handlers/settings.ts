/** Messaging session + contract templates (minimal until the full modules land). */
import type { WhatsAppSession } from '@/features/messaging/types';

import { now, paginate, requirePerm, route, uuid } from '../core';

let session: WhatsAppSession = {
  uuid: uuid(),
  status: 'disconnected',
  created_at: now(),
  updated_at: now(),
};

route('GET', '/v1/tenant/messaging/session', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.read');
  return session;
});

route('POST', '/v1/tenant/messaging/session/connect', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.write');
  session = { ...session, status: 'connected', phone_number: '905321234567', display_name: 'Parlak Oto', last_seen_at: now(), updated_at: now() };
  return session;
});

route('DELETE', '/v1/tenant/messaging/session', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.write');
  session = { ...session, status: 'disconnected', phone_number: undefined, display_name: undefined, updated_at: now() };
  return { disconnected: true };
});

route('GET', '/v1/tenant/contracts/templates', (ctx) => {
  requirePerm(ctx, 'tenant.contracts.read');
  return paginate([], ctx.query);
});
