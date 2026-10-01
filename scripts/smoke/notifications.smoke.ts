/* Notifications smoke test: web → app link mapping, notification actions, and the mock inbox /
 * push-device / preference endpoints through the real client. Run via `npm run test:smoke`. */
import { request } from '@/api/client';
import { isApiError } from '@/api/errors';
import { installMockTransport } from '@/api/mock';
import { NOTIFICATION_KINDS, pushDevicesOf } from '@/api/mock/handlers/notifications';
import { session } from '@/api/session';
import {
  canMarkNotificationRead,
  isUnreadNotification,
  linkHref,
  notificationTarget,
  parseSignedActionUrl,
  resolveWebPath,
  rewriteSystemPath,
  toWebPath,
} from '@/features/notifications/deep-links';
import { catalogs } from '@/locales';

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
    return isApiError(e) ? e.code : String(e);
  }
}
async function login(email: string) {
  await session.clear('smoke');
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
  return me;
}
const href = (input: string) => {
  const r = resolveWebPath(input);
  return r?.kind === 'tenant' ? `${r.slug} ${r.href}` : r ? `${r.kind} ${r.href}` : null;
};
const UUID = '0a900000-0000-4000-8000-00000000abcd';
const PURCHASE_WORDS = /yükselt|satın|fiyat|ödeme|abone ol|upgrade|purchase|buy|price|subscribe|payment/i;

(async () => {
  console.log('toWebPath');
  ok(toWebPath('https://otopoly.app/t/parlak-oto/quotes/x?a=1#h') === '/t/parlak-oto/quotes/x?a=1', 'https universal link → path + query, hash dropped');
  ok(toWebPath('https://www.otopoly.app/t/x/') === '/t/x', 'www host, trailing slash');
  ok(toWebPath('otopoly://t/x/todos') === '/t/x/todos' && toWebPath('otopoly:///t/x/todos') === '/t/x/todos', 'custom scheme with and without empty host');
  ok(toWebPath('exp://192.168.1.5:8081/--/t/x/cari') === '/t/x/cari', 'Expo dev URL /--/ prefix');
  ok(toWebPath('https://evil.example/t/x') === null && toWebPath('') === null && toWebPath('mailto:a@b.c') === null, 'other hosts / schemes ignored');

  console.log('resolveWebPath (tenant)');
  const cases: [string, string][] = [
    ['/t/parlak-oto', 'parlak-oto /'],
    [`/t/parlak-oto/quotes/${UUID}`, `parlak-oto /quotes/${UUID}`],
    [`/t/parlak-oto/quotes/${UUID}/edit`, `parlak-oto /quotes/form?id=${UUID}`],
    ['/t/parlak-oto/quotes/new', 'parlak-oto /quotes/form'],
    [`/t/parlak-oto/todos?todo=${UUID}`, `parlak-oto /todos?todo=${UUID}`],
    ['/t/parlak-oto/todos', 'parlak-oto /todos'],
    ['/t/parlak-oto/settings/billing', 'parlak-oto /settings/usage'],
    ['/t/parlak-oto/settings/billing/plans', 'parlak-oto /settings/usage'],
    ['/t/parlak-oto/settings/messaging', 'parlak-oto /settings/messaging'],
    [`/t/parlak-oto/operations/${UUID}`, `parlak-oto /jobs/${UUID}`],
    ['/t/parlak-oto/operations', 'parlak-oto /operations'],
    [`/t/parlak-oto/customers/${UUID}`, `parlak-oto /customers/${UUID}`],
    ['/t/parlak-oto/finance/transactions/expense/new', 'parlak-oto /finance/transactions/new?type=expense'],
    ['/t/parlak-oto/finance/transfers/new', 'parlak-oto /finance/transfer'],
    [`/t/parlak-oto/catalog/services/${UUID}`, `parlak-oto /catalog/services/${UUID}`],
    [`/t/parlak-oto/contracts/instances/${UUID}`, `parlak-oto /contracts/instances/${UUID}`],
    [`/t/parlak-oto/exports/${UUID}`, `parlak-oto /exports/${UUID}`],
    ['/t/parlak-oto/profile/preferences', 'parlak-oto /profile/preferences'],
    ['/t/other-org/some/unknown/page', 'other-org /'],
    [`https://otopoly.app/t/parlak-oto/leads/${UUID}`, `parlak-oto /leads/${UUID}`],
  ];
  for (const [input, want] of cases) ok(href(input) === want, `${input} → ${want}${href(input) === want ? '' : ` (got ${href(input)})`}`);

  console.log('resolveWebPath (public / QR)');
  ok(href('https://otopoly.app/q/abc123') === 'quote /q/abc123', '/q/{token} → public quote screen');
  ok(href('/login/qr/s3ss10n') === 'qr /login/qr/s3ss10n', '/login/qr/{id} → QR sign-in stub');
  ok(resolveWebPath('/q') === null && resolveWebPath('/platform/users') === null && resolveWebPath('/login') === null, 'non-app web pages → null');

  console.log('+native-intent rewrite');
  ok(rewriteSystemPath('https://otopoly.app/t/parlak-oto/quotes/1') === linkHref('/t/parlak-oto/quotes/1'), 'tenant link → /link?to=…');
  ok(linkHref('/t/a/todos?todo=1') === '/link?to=%2Ft%2Fa%2Ftodos%3Ftodo%3D1', 'link href encodes the whole path + query');
  ok(rewriteSystemPath('https://otopoly.app/q/tok') === '/q/tok' && rewriteSystemPath('otopoly://login/qr/x') === '/login/qr/x', 'public quote / QR open directly');
  ok(rewriteSystemPath('/jobs/123') === '/jobs/123' && rewriteSystemPath('otopoly://customers') === 'otopoly://customers', 'app-native paths untouched');

  console.log('notification actions');
  ok(JSON.stringify(notificationTarget('/t/parlak-oto/quotes/1')) === JSON.stringify({ kind: 'web', path: '/t/parlak-oto/quotes/1' }), 'web path → resolver');
  ok(notificationTarget(`/v1/tenant/exports/${UUID}/download`, { activeSlug: 'parlak-oto', payload: { organization_slug: 'parlak-oto' } })?.kind === 'app', 'export download in the active org → export screen');
  const other = notificationTarget(`/v1/tenant/exports/${UUID}/download`, { activeSlug: 'parlak-oto', payload: { organization_slug: 'x' } });
  ok(other?.kind === 'web' && other.path === `/t/x/exports/${UUID}`, 'export of another org → resolver (switches org)');
  ok(notificationTarget('/v1/platform/users/1') === null && notificationTarget('/v1/auth/me') === null && notificationTarget(undefined) === null, 'API / platform URLs have no app action');
  ok(notificationTarget('https://example.com/x')?.kind === 'external' && notificationTarget('https://otopoly.app/t/a/todos')?.kind === 'web', 'external vs own-domain URLs');
  ok(JSON.stringify(parseSignedActionUrl('/v1/notifications/u1/action?exp=99&sig=a.b')) === JSON.stringify({ uuid: 'u1', exp: 99, sig: 'a.b' }) && parseSignedActionUrl('/v1/x') === null, 'signed action URL parsing');
  ok(isUnreadNotification({ status: 'delivered' }) && !isUnreadNotification({ status: 'delivered', read_at: 'x' }) && !isUnreadNotification({ status: 'failed' }), 'unread status rule');
  ok(canMarkNotificationRead({ channel: 'inapp', status: 'sent' }) && !canMarkNotificationRead({ channel: 'email', status: 'sent' }), 'only in-app rows can be marked read');

  console.log('copy');
  for (const locale of ['tr', 'en'] as const) {
    const mobile = catalogs[locale].mobile as Record<string, string>;
    const keys = Object.keys(mobile).filter((k) => k.startsWith('notifications.'));
    ok(keys.length > 20, `${locale}: notifications area loaded (${keys.length} keys)`);
    ok(!keys.some((k) => PURCHASE_WORDS.test(mobile[k])), `${locale}: no purchase wording`);
  }

  await installMockTransport();

  console.log('inbox (owner)');
  await login('demo@otopoly.com');
  const first = await request<any>('GET', '/v1/notifications', { query: { limit: 20, offset: 0, channel: 'inapp' } });
  const kinds = new Set<string>();
  let all: any[] = [...first.items];
  for (let off = 20; off < first.total; off += 20) all = all.concat((await request<any>('GET', '/v1/notifications', { query: { limit: 20, offset: off } })).items);
  all.forEach((n) => kinds.add(n.template_code));
  ok(first.items.length === 20 && first.total > 20 && all.length === first.total, `paginates (${first.total} items)`);
  ok(NOTIFICATION_KINDS.every((k) => kinds.has(k)), 'owner has every contract kind');
  ok(all.every((n, i) => i === 0 || all[i - 1].created_at >= n.created_at), 'sorted newest first');
  ok(!all.some((n) => '_user' in n), 'internal fields stripped');
  const quote = all.find((n) => n.template_code.startsWith('quote.'));
  const todo = all.find((n) => n.template_code === 'todo.reminder');
  const billing = all.filter((n) => n.template_code.startsWith('billing.'));
  ok(/^\/t\/parlak-oto\/quotes\/[^/]+$/.test(quote.action_url) && resolveWebPath(quote.action_url)?.href.startsWith('/quotes/'), 'quote action_url → /t/{slug}/quotes/{uuid} → app quote');
  ok(/^\/t\/parlak-oto\/todos\?todo=/.test(todo.action_url) && resolveWebPath(todo.action_url)?.href.startsWith('/todos?todo='), 'todo action_url → /todos?todo=');
  ok(billing.every((n) => n.action_url === '/t/parlak-oto/settings/billing' && resolveWebPath(n.action_url)?.href === '/settings/usage'), 'billing kinds → usage screen');
  ok(!all.some((n) => PURCHASE_WORDS.test(`${n.title} ${n.body}`)), 'no purchase wording in notification copy');

  const unread0 = (await request<any>('GET', '/v1/notifications/unread-count')).count;
  const unreadList = await request<any>('GET', '/v1/notifications', { query: { unread: true, limit: 50 } });
  ok(unread0 > 0 && unreadList.total === unread0 && unreadList.items.every((n: any) => !n.read_at), `unread count matches unread filter (${unread0})`);

  const target = unreadList.items[0];
  const read = await request<any>('POST', `/v1/notifications/${target.uuid}/read`);
  ok(read.read_at && read.status === 'read', 'mark read sets read_at + status');
  ok((await request<any>('GET', '/v1/notifications/unread-count')).count === unread0 - 1, 'unread count drops by one');

  const signed = unreadList.items.find((n: any) => n.uuid !== target.uuid && n.signed_action_url);
  const parsed = parseSignedActionUrl(signed.signed_action_url)!;
  const action = await request<any>('GET', `/v1/notifications/${parsed.uuid}/action`, { query: { exp: parsed.exp, sig: parsed.sig } });
  ok(action.destination === signed.action_url && action.notification.read_at, 'signed action redeems destination and marks read');
  ok((await code(request('GET', `/v1/notifications/${parsed.uuid}/action`, { query: { exp: parsed.exp, sig: 'forged' }, silent: true }))) === 'INVALID_SIGNATURE', 'forged signature → INVALID_SIGNATURE');

  await request('POST', '/v1/notifications/read-all');
  ok((await request<any>('GET', '/v1/notifications/unread-count')).count === 0, 'read-all clears the badge');
  const test = await request<any>('POST', '/v1/notifications/test', { body: {} });
  ok(test.items.length === 1 && test.items[0].action_url && (await request<any>('GET', '/v1/notifications/unread-count')).count === 1, 'test notification lands unread with a link');
  ok((await code(request('GET', '/v1/notifications/00000000-0000-4000-8000-000000000000', { silent: true }))) === 'NOT_FOUND', 'unknown notification → 404');

  console.log('inbox (staff)');
  const ownerTestUuid = test.items[0].uuid;
  await login('personel@otopoly.com');
  const staff = await request<any>('GET', '/v1/notifications', { query: { limit: 100 } });
  ok(staff.total > 0 && !staff.items.some((n: any) => n.template_code.startsWith('billing.')), 'staff get quote/todo kinds, no owner billing alerts');
  ok((await code(request('POST', `/v1/notifications/${ownerTestUuid}/read`, { silent: true }))) === 'NOT_FOUND', "another user's notification is not visible");

  console.log('push devices + preferences');
  await login('demo@otopoly.com');
  const token = 'ExponentPushToken[smoke-device-1]';
  const prefsBefore = await request<any>('GET', '/v1/notification-preferences');
  ok(prefsBefore.push_enabled === false, 'push_enabled starts off (no preference row)');
  const reg = await request<any>('POST', '/v1/push-devices', { body: { token, platform: 'ios', locale: 'tr-TR', app_version: '1.0.0 (1)', device_name: 'iPhone' } });
  ok(reg.device.token === token && reg.device.locale === 'tr' && reg.push_enabled === true, 'register: device returned, locale normalized, first registration turns push on');
  ok((await request<any>('GET', '/v1/notification-preferences')).push_enabled === true, 'preference row created with push_enabled=true');
  await request('PUT', '/v1/notification-preferences', { body: { email_enabled: true, inapp_enabled: true, realtime_enabled: true, push_enabled: false } });
  const again = await request<any>('POST', '/v1/push-devices', { body: { token, platform: 'ios', app_version: '1.0.1 (2)' } });
  ok(again.device.uuid === reg.device.uuid && again.device.app_version === '1.0.1 (2)' && again.push_enabled === false, 'upsert keeps the device and leaves an existing preference untouched');
  ok((await code(request('POST', '/v1/push-devices', { body: { token: 'nope', platform: 'web' }, silent: true }))) === 'VALIDATION_ERROR', 'invalid token / platform → VALIDATION_ERROR');
  const me = await request<any>('GET', '/v1/auth/me');
  ok(pushDevicesOf(me.user.uuid).length === 1, 'one device for the owner');

  const staffMe = await login('personel@otopoly.com');
  await request('POST', '/v1/push-devices', { body: { token, platform: 'ios' } });
  ok(pushDevicesOf(staffMe.user.uuid).length === 1 && pushDevicesOf(me.user.uuid).length === 0, 'same phone, new account: token moves to the caller');
  await login('demo@otopoly.com');
  await request('DELETE', `/v1/push-devices/${encodeURIComponent(token)}`);
  ok(pushDevicesOf(staffMe.user.uuid).length === 1, "delete of another user's token changes nothing");
  await login('personel@otopoly.com');
  const del = await request<any>('DELETE', `/v1/push-devices/${encodeURIComponent(token)}`);
  const del2 = await request<any>('DELETE', `/v1/push-devices/${encodeURIComponent(token)}`);
  ok(del.status === 'ok' && del2.status === 'ok' && pushDevicesOf(staffMe.user.uuid).length === 0, 'delete removes the device and is idempotent');
  await session.clear('smoke');
  ok((await code(request('POST', '/v1/push-devices', { body: { token, platform: 'ios' }, silent: true }))) === 'UNAUTHENTICATED', 'register needs auth');

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
