/* Live updates smoke test: payload parsing, invalidation targets, debounce, the hub's reconnect / pause /
 * refusal paths with the silent mock driver, and the realtime token routes of the mock API.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { QueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { session } from '@/api/session';
import { createBatcher } from '@/lib/realtime/batcher';
import { createCentrifugeDriver } from '@/lib/realtime/centrifuge-driver';
import { LiveHub } from '@/lib/realtime/live-hub';
import { detailUuid, matchesLive } from '@/lib/realtime/live-targets';
import { createMockDriver, type MockRealtimeDriver } from '@/lib/realtime/mock-driver';
import { eventsTouch, parseResourceChanged } from '@/lib/realtime/resource-events';
import { organizationResourceChannel, type ResourceChangedEvent } from '@/lib/realtime/types';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function expectError(p: Promise<unknown>, code: string, msg: string) {
  try {
    await p;
    ok(false, `${msg} (expected ${code})`);
  } catch (e) {
    ok((e as { code?: string }).code === code, `${msg} → ${(e as { code?: string }).code}`);
  }
}
async function login(email: string) {
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
  return me.organizations[0].uuid as string;
}
const ev = (action: ResourceChangedEvent['action'], uuids: string[], extra: Partial<ResourceChangedEvent> = {}) => ({
  type: 'resource.changed',
  resource: 'tenant.jobs',
  action,
  uuids,
  truncated: false,
  at: new Date().toISOString(),
  ...extra,
});

(async () => {
  console.log('payload');
  const parsed = parseResourceChanged(ev('updated', ['a', 'b']));
  ok(parsed?.resource === 'tenant.jobs' && parsed.action === 'updated' && parsed.uuids.length === 2, 'flat payload parsed');
  ok(parseResourceChanged({ event: 'resource.changed', data: { resource: 'tenant.todos', action: 'bulk', uuids: [] } })?.action === 'bulk', 'enveloped payload parsed');
  ok(parseResourceChanged({ type: 'join' }) === null && parseResourceChanged({ type: 'resource.changed', resource: 'x', action: 'nope' }) === null, 'other / invalid messages ignored');
  ok(eventsTouch([parsed!], 'a') && !eventsTouch([parsed!], 'z') && eventsTouch([{ ...parsed!, truncated: true }], 'z'), 'eventsTouch');

  console.log('targets');
  const batch = [parseResourceChanged(ev('updated', ['A']))!];
  ok(detailUuid(['jobs', 'detail', 'A']) === 'A' && detailUuid(['contracts', 'instances', 'detail', 'C']) === 'C' && detailUuid(['jobs', 'list', {}]) === null, 'detail keys recognised');
  ok(matchesLive('tenant.jobs', ['jobs', 'list', { status: 'open' }], batch, false), 'list refetched');
  ok(matchesLive('tenant.jobs', ['jobs', 'detail', 'A'], batch, false), 'detail of a changed job refetched');
  ok(!matchesLive('tenant.jobs', ['jobs', 'detail', 'B'], batch, false), 'detail of another job left alone');
  ok(matchesLive('tenant.jobs', ['jobs', 'detail', 'B'], batch, true), '…unless everything is refetched (reconnect)');
  ok(matchesLive('tenant.jobs', ['jobs', 'detail', 'B'], [parseResourceChanged(ev('bulk', []))!], false), 'bulk without uuids covers every row');
  ok(matchesLive('tenant.jobs', ['reports', 'overview', {}], batch, false) && matchesLive('tenant.jobs', ['calendar', 'feed', 'x'], batch, false), 'related: reports + calendar');
  ok(!matchesLive('tenant.jobs', ['customers', 'list', {}], batch, false), 'other modules untouched');
  ok(matchesLive('tenant.finance.transactions', ['finance', 'account', 'acc-1'], batch, false), 'transactions refresh account balances');
  ok(!matchesLive('tenant.catalog.products', ['catalog', 'service', 'S'], batch, false) && matchesLive('tenant.catalog.products', ['catalog', 'summary'], batch, false), 'catalog sub-keys');

  console.log('debounce');
  const flushes: { n: number; all: boolean }[] = [];
  const b = createBatcher<number>((items, all) => flushes.push({ n: items.length, all }), { delayMs: 40, maxWaitMs: 200 });
  b.push(1);
  await sleep(10);
  b.push(2);
  await sleep(10);
  b.push(3);
  await sleep(80);
  ok(flushes.length === 1 && flushes[0].n === 3 && !flushes[0].all, 'burst → one flush');
  b.refetchAll();
  b.push(4);
  await sleep(80);
  ok(flushes.length === 2 && flushes[1].all && flushes[1].n === 1, 'refetchAll joins the next flush');
  for (let i = 0; i < 12; i++) {
    b.push(i);
    await sleep(25);
  }
  ok(flushes.length >= 3, `max wait bounds a constant stream (${flushes.length - 2} flushes)`);
  b.cancel();

  console.log('mock API tokens');
  await installMockTransport();
  const orgUuid = await login('demo@otopoly.com');
  const conn = await request<any>('POST', '/v1/realtime/connection-token');
  ok(conn.token && conn.ws_url && conn.expires_at, 'connection token');
  const sub = await request<any>('POST', '/v1/realtime/subscription-token', { body: { channel: organizationResourceChannel(orgUuid, 'tenant.jobs') } });
  ok(sub.token && sub.channel.endsWith(':tenant.jobs'), 'subscription token for own organization');
  await expectError(request('POST', '/v1/realtime/subscription-token', { body: { channel: organizationResourceChannel('00000000-0000-0000-0000-000000000000', 'tenant.jobs') } }), 'FORBIDDEN', 'other organization refused');
  await expectError(request('POST', '/v1/realtime/subscription-token', { body: { channel: organizationResourceChannel(orgUuid, 'tenant.secrets') } }), 'FORBIDDEN', 'unknown resource refused');
  await expectError(request('POST', '/v1/realtime/subscription-token', { body: {} }), 'VALIDATION_ERROR', 'channel required');

  console.log('hub');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const seed = () => {
    for (const key of [['jobs', 'list', {}], ['jobs', 'detail', 'A'], ['jobs', 'detail', 'B'], ['customers', 'list', {}]]) qc.setQueryData(key, { seeded: true });
  };
  const invalidated = (key: unknown[]) => Boolean(qc.getQueryState(key)?.isInvalidated);
  seed();
  const hub = new LiveHub({ debounceMs: 30, maxWaitMs: 300, resumeFallbackMs: 100 });
  hub.setQueryClient(qc);
  let driver!: MockRealtimeDriver;
  const batches: { n: number; reconnected: boolean }[] = [];
  const release = hub.watch('tenant.jobs', (events, reconnected) => batches.push({ n: events.length, reconnected }));
  const releaseTwice = hub.watch('tenant.jobs');
  hub.start(orgUuid, () => (driver = createMockDriver()));
  await sleep(30);
  const channel = organizationResourceChannel(orgUuid, 'tenant.jobs');
  ok(hub.getState() === 'connected' && driver.channels().includes(channel), 'connected and subscribed once per resource');
  driver.emit(channel, ev('updated', ['A']));
  driver.emit(channel, ev('updated', ['A']));
  driver.emit(channel, { ...ev('created', ['X']), resource: 'tenant.sales' });
  await sleep(60);
  ok(batches.length === 1 && batches[0].n === 2 && !batches[0].reconnected, 'two events, one debounced batch (other resource ignored)');
  ok(invalidated(['jobs', 'list', {}]) && invalidated(['jobs', 'detail', 'A']), 'list + changed detail invalidated');
  ok(!invalidated(['jobs', 'detail', 'B']) && !invalidated(['customers', 'list', {}]), 'unrelated detail / module kept');

  seed();
  driver.drop();
  driver.restore();
  await sleep(60);
  ok(batches.length === 2 && batches[1].reconnected && invalidated(['jobs', 'detail', 'B']), 'reconnect → one full refetch');

  seed();
  hub.pause();
  ok(hub.getState() === 'idle', 'paused in background');
  driver.emit(channel, ev('updated', ['A']));
  await sleep(60);
  ok(batches.length === 2, 'nothing delivered while paused');
  hub.resume();
  await sleep(60);
  ok(batches.length === 3 && batches[2].reconnected && invalidated(['jobs', 'detail', 'B']), 'foreground → reconnect + one refetch');
  await sleep(150);
  ok(batches.length === 3, 'no second refetch from the resume fallback');

  release();
  ok(driver.channels().includes(channel), 'still subscribed while another screen watches');
  releaseTwice();
  ok(!driver.channels().includes(channel) && hub.watchedResources().length === 0, 'last watcher releases the channel');

  console.log('fail-soft');
  hub.stop();
  const foreign = new LiveHub({ debounceMs: 30 });
  foreign.setQueryClient(qc);
  let foreignDriver!: MockRealtimeDriver;
  const seen: number[] = [];
  const r2 = foreign.watch('tenant.jobs', (events) => seen.push(events.length));
  foreign.start('00000000-0000-0000-0000-000000000000', () => (foreignDriver = createMockDriver()));
  await sleep(40);
  foreignDriver.emit(organizationResourceChannel('00000000-0000-0000-0000-000000000000', 'tenant.jobs'), ev('updated', ['A']));
  await sleep(60);
  ok(foreignDriver.channels().length === 0 && seen.length === 0, 'refused channel: no subscription, no events, no crash');
  r2();
  foreign.stop();

  await session.clear('smoke');
  const anon = new LiveHub();
  anon.start(orgUuid, () => createMockDriver());
  await sleep(30);
  ok(anon.getState() === 'unavailable', 'no session → unavailable (app works as before)');
  anon.stop();
  ok(anon.getState() === 'idle', 'stop → idle');

  // The real Centrifugo driver bundles for Node too; a refused connection token never opens a socket.
  const real = createCentrifugeDriver();
  const states: string[] = [];
  real.onState((s) => states.push(s));
  real.subscribe(channel, () => undefined);
  real.connect();
  await sleep(30);
  ok(states.at(-1) === 'unavailable', `centrifuge driver: refused token → unavailable (${states.join(' → ')})`);
  real.close();

  console.log(failures ? `FAILED (${failures})` : 'ALL LIVE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
