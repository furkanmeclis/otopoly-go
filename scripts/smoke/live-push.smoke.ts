/* Live Activity / widget push smoke test (docs/LIVE_WIDGETS.md): silent push parsing in every shape the
 * background task receives, the Android Live Update decision, widget props from a server snapshot, and the
 * register / rotate / unregister flow of the activity registry and the widget device link against the mock API.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { linkedDevicesOf, liveActivitiesOf } from '@/api/mock/handlers/live-activities';
import { session } from '@/api/session';
import { createActivityPushRegistry, createWidgetDeviceLink, REREGISTER_AFTER_MS, type PushTokenEvent } from '@/features/widgets/live-push';
import { buildTodayPropsFromSnapshot } from '@/features/widgets/props';
import { isSilentPush, liveJobAction, parseLivePush, type LiveJobPush, type WidgetSnapshot } from '@/features/widgets/push-payload';
import { liveActivitiesService } from '@/features/widgets/services/live-activities.service';
import { createFormatters } from '@/lib/i18n/format';
import { translate } from '@/lib/i18n/translate';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
}
async function login(email: string) {
  await session.clear('smoke');
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
  return { userUuid: me.user.uuid as string, orgUuid: me.organizations[0].uuid as string };
}

const ORG = '11111111-2222-4333-8444-555555555555';
const JOB = '6a1f5f1e-6b5c-4c8e-9a51-1f2f3a4b5c6d';
const props = {
  v: 1,
  jobId: JOB,
  plate: '34 ABC 123',
  customer: 'Ahmet Yılmaz',
  vehicle: 'Renault Clio',
  services: 'Yıkama',
  status: 'ready',
  startedAt: 1_800_000_000_000,
  finishedAt: 1_800_000_600_000,
  org: 'Oto Kuaför',
  labels: { status: 'Teslime hazır', elapsed: 'Geçen süre', hint: 'Araç teslime hazır', channel: 'Canlı iş takibi' },
};
const liveJob = { kind: 'live.job', org: ORG, job: JOB, end: '', props, sent_at: 10 };
const snapshot: WidgetSnapshot = {
  v: 1,
  date: '2026-10-26',
  at: 1_800_000_000_000,
  counts: { in_progress: 3, ready: 1, delivered: 4 },
  paid_total: '1250.50',
  queue: [
    { id: 'a', plate: '34 R 1', name: 'Ready Car', vehicle: 'Fiat Egea', status: 'ready', started_at: new Date(Date.now() - 30 * 60_000).toISOString() },
    { id: 'b', plate: '34 W 2', name: 'Old Car', vehicle: 'Ford Focus', status: 'in_progress', started_at: new Date(Date.now() - 5 * 3600_000).toISOString() },
  ],
  more: 0,
};

(async () => {
  console.log('payload shapes');
  const androidTask = { data: { dataString: JSON.stringify(liveJob), body: JSON.stringify(liveJob) }, notification: null };
  const iosTask = { data: { body: { kind: 'widgets.refresh', org: ORG, snapshot }, dataString: JSON.stringify({ kind: 'widgets.refresh', org: ORG, snapshot }) }, aps: { 'content-available': 1 } };
  const foreground = { request: { content: { title: null, body: null, data: liveJob } } };
  const parsedJob = parseLivePush(androidTask);
  ok(parsedJob?.kind === 'live.job' && parsedJob.props.plate === '34 ABC 123' && parsedJob.end === '' && parsedJob.sentAt === 10, 'Android background task (dataString JSON) → live.job');
  const parsedWidgets = parseLivePush(iosTask);
  ok(parsedWidgets?.kind === 'widgets.refresh' && parsedWidgets.snapshot.counts.delivered === 4, 'iOS background task → widgets.refresh');
  ok(parseLivePush(foreground)?.kind === 'live.job' && isSilentPush(foreground), 'foreground notification recognised as silent');
  ok(!isSilentPush({ request: { content: { title: 'Teklif', data: { kind: 'quote.team_accepted', url: '/t/x' } } } }), 'regular notifications still shown');
  ok(parseLivePush({ data: { dataString: '{nope' } }) === null && parseLivePush(null) === null, 'malformed data ignored');
  ok(parseLivePush({ ...liveJob, job: 'other' }) === null, 'job / props mismatch rejected');
  ok(parseLivePush({ ...liveJob, props: { ...props, status: 'voided' } }) === null, 'unknown activity status rejected');

  console.log('Android Live Update decision');
  const push = parsedJob as LiveJobPush;
  ok(liveJobAction(push, { activeOrg: ORG, trackedJobIds: [JOB] }) === 'post', 'tracked job → post');
  ok(liveJobAction(push, { activeOrg: ORG, trackedJobIds: [] }) === 'ignore', 'tracking stopped on this device → ignore');
  ok(liveJobAction(push, { activeOrg: 'other-org', trackedJobIds: [JOB] }) === 'ignore', 'other organization → ignore');
  ok(liveJobAction(push, { activeOrg: ORG, trackedJobIds: [JOB], lastSentAt: 20 }) === 'ignore', 'older push never overwrites a newer one');
  ok(liveJobAction({ ...push, end: 'default' }, { activeOrg: ORG, trackedJobIds: [JOB] }) === 'final', 'delivered → final post');
  ok(liveJobAction({ ...push, end: 'immediate' }, { activeOrg: ORG, trackedJobIds: [JOB] }) === 'end', 'voided → removed');

  console.log('widget props from snapshot');
  const fmt = createFormatters('tr');
  const w = buildTodayPropsFromSnapshot({ org: 'Oto Kuaför', logo: '', snapshot, tr: (k, p) => translate('tr', k, p), fmt });
  ok(w.v === 1 && w.state === 'ok' && w.org === 'Oto Kuaför' && w.showMoney, 'signed-in card with money');
  ok(w.stats.inProgress === 3 && w.stats.ready === 1 && w.stats.delivered === 4, 'counts copied');
  ok(w.stats.collected === fmt.money('1250.50') && w.stats.stale === 1, 'money formatted, stale in-progress car flagged');
  ok(w.queue[0].status === 'ready' && w.queue[0].since !== '' && w.labels.queue === translate('tr', 'mobile.widgets.queue'), 'queue items + translated labels');

  await installMockTransport();
  const { userUuid } = await login('demo@otopoly.com');
  const jobs = await request<any>('GET', '/v1/tenant/jobs', { query: { limit: 5, include_open: 'true' } });
  const jobId: string = jobs.items[0].uuid;
  const device = 'ExponentPushToken[smoke-live-1]';
  await request('POST', '/v1/push-devices', { body: { token: device, platform: 'android' } });

  console.log('Android registry');
  let clock = 1_000;
  const android = createActivityPushRegistry({ platform: 'android', service: liveActivitiesService, deviceToken: async () => device, locale: () => 'tr', now: () => clock });
  await android.track(jobId, { getId: () => jobId });
  let rows = liveActivitiesOf(userUuid);
  ok(rows.length === 1 && rows[0].platform === 'android' && rows[0].activity_id === jobId && rows[0].device === device, 'tracked job registered with the device token');
  const firstExpiry = rows[0].expires_at;
  await android.track(jobId, { getId: () => jobId });
  ok(liveActivitiesOf(userUuid)[0].expires_at === firstExpiry, 'relaunch inside the window is deduped');
  clock += REREGISTER_AFTER_MS + 1;
  await new Promise((r) => setTimeout(r, 5));
  await android.track(jobId, { getId: () => jobId });
  ok(liveActivitiesOf(userUuid).length === 1, 're-registration refreshes the same row');
  ok(android.trackedJobIds().includes(jobId), 'job tracked');
  await android.untrack(jobId);
  ok(liveActivitiesOf(userUuid).length === 0 && android.trackedJobIds().length === 0, 'untrack removes it on the server');

  console.log('iOS registry (token arrives late, then rotates)');
  let listener: ((e: PushTokenEvent) => void) | null = null;
  let removed = false;
  const activity = {
    getId: () => 'ACT-1',
    getPushToken: async () => null,
    addPushTokenListener: (l: (e: PushTokenEvent) => void) => {
      listener = l;
      return { remove: () => (removed = true) };
    },
  };
  const ios = createActivityPushRegistry({ platform: 'ios', service: liveActivitiesService, deviceToken: async () => null, locale: () => 'en' });
  await ios.track(jobId, activity);
  ok(liveActivitiesOf(userUuid).length === 0 && listener !== null, 'no token yet: waits for the listener');
  listener!({ activityId: 'ACT-1', pushToken: 'ab'.repeat(32) });
  await new Promise((r) => setTimeout(r, 10));
  rows = liveActivitiesOf(userUuid);
  ok(rows.length === 1 && rows[0].platform === 'ios' && rows[0].activity_id === 'ACT-1', 'first token registers the activity');
  listener!({ activityId: 'ACT-1', pushToken: 'cd'.repeat(32) });
  await new Promise((r) => setTimeout(r, 10));
  ok(liveActivitiesOf(userUuid).length === 1, 'rotated token updates the same activity');
  await ios.untrackAll();
  ok(removed && liveActivitiesOf(userUuid).length === 0, 'sign-out: listener removed, server row gone');

  console.log('validation + isolation');
  ok((await code(liveActivitiesService.registerActivity(jobId, { platform: 'ios', activity_id: 'x', push_token: 'not-hex' }))) === 'VALIDATION_ERROR', 'iOS without a hex token → VALIDATION_ERROR');
  ok((await code(liveActivitiesService.registerActivity('00000000-0000-4000-8000-000000000000', { platform: 'android', activity_id: 'x', device_token: device }))) === 'NOT_FOUND', 'unknown / foreign job → 404');
  ok((await code(liveActivitiesService.registerActivity(jobId, { platform: 'android', activity_id: jobId, device_token: 'ExponentPushToken[not-mine]' }))) === 'NOT_FOUND', "someone else's device → 404");

  console.log('widget device link');
  const link = createWidgetDeviceLink({ service: liveActivitiesService, deviceToken: async () => device });
  link.setPushToStartToken('ef'.repeat(32));
  ok(await link.sync({ orgUuid: 'org', orgName: 'Org' }), 'device linked');
  const linked = linkedDevicesOf(userUuid);
  ok(linked.length === 1 && linked[0].widgets && linked[0].pushToStart === 'ef'.repeat(32), 'widgets on, push-to-start token stored');
  await liveActivitiesService.unregisterDevice(device);
  ok(linkedDevicesOf(userUuid).length === 0, 'unlink');
  const noToken = createWidgetDeviceLink({ service: liveActivitiesService, deviceToken: async () => null });
  ok((await noToken.sync({ orgUuid: 'org', orgName: 'Org' })) === false, 'no Expo token yet → nothing sent');

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
