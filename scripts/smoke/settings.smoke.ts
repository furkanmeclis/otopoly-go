/* Settings-area smoke test (messaging, billing, letterhead, assistant) through the real client.
 * Run: esbuild like `npm run test:mock`, with scripts/smoke/settings.smoke.ts as the entry. */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { session } from '@/api/session';
import { aiService } from '@/features/ai/services/ai.service';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
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
}

(async () => {
  await installMockTransport();
  await login('demo@otopoly.com');

  console.log('messaging');
  const s0 = await request<any>('GET', '/v1/tenant/messaging/session');
  ok(s0.status === 'disconnected', 'session starts disconnected');
  const s1 = await request<any>('POST', '/v1/tenant/messaging/session/connect');
  ok(s1.status === 'qr_pending' && s1.qr_code && s1.qr_expires_at, 'connect → qr_pending with QR');
  const rules = await request<any[]>('GET', '/v1/tenant/messaging/rules');
  ok(rules.length > 5 && rules[0].rules.length === 2, `rules: ${rules.length}`);
  const r = await request<any>('PATCH', `/v1/tenant/messaging/rules/${rules[0].event_type}/whatsapp`, { body: { enabled: true } });
  ok(r.enabled === true, 'toggle rule');
  const cat = await request<any[]>('GET', '/v1/tenant/messaging/template-types');
  ok(cat.length === 16, `template types: ${cat.length}`);
  const saved = await request<any>('PUT', '/v1/tenant/messaging/template-types/job.ready/whatsapp/tr', { body: { subject: 'Hazır', body: 'Merhaba {{customer_name}}', is_active: true } });
  ok(saved.is_custom && saved.body === 'Merhaba {{customer_name}}', 'template saved as override');
  await expectError(request('PUT', '/v1/tenant/messaging/template-types/job.ready/whatsapp/tr', { body: { body: 'x {{nope}}' } }), 'VALIDATION_ERROR', 'unknown placeholder rejected');
  const reset = await request<any>('DELETE', '/v1/tenant/messaging/template-types/job.ready/whatsapp/tr');
  ok(!reset.is_custom, 'template reset');
  const sim = await request<any>('POST', '/v1/tenant/messaging/simulate', { body: { mode: 'job_lifecycle', phone: '05321234567', vars: {} } });
  ok(sim.items.length === 4, 'lifecycle simulate returns 4 items');
  const ds = await request<any>('GET', '/v1/tenant/daily-summary');
  ok(ds.members.length > 0 && ds.send_time, 'daily summary settings');
  const ds2 = await request<any>('PUT', '/v1/tenant/daily-summary', { body: { enabled: true, send_time: '21:30', recipient_user_uuids: ds.recipient_user_uuids } });
  ok(ds2.send_time === '21:30', 'daily summary saved');
  await expectError(request('PUT', '/v1/tenant/daily-summary', { body: { enabled: true, send_time: '25:00', recipient_user_uuids: [] } }), 'VALIDATION_ERROR', 'invalid time rejected');
  const prev = await request<any>('GET', '/v1/tenant/daily-summary/preview');
  ok(prev.message.includes('*'), 'preview message');
  const va = await request<any>('GET', '/v1/tenant/vehicle-alerts');
  const va2 = await request<any>('PUT', '/v1/tenant/vehicle-alerts', { body: { enabled: true, events: ['created'], service_uuids: [], recipient_user_uuids: va.recipient_user_uuids, batch_minutes: 30 } });
  ok(va2.enabled && va2.batch_minutes === 30, 'vehicle alerts saved');
  const test = await request<any>('POST', '/v1/tenant/vehicle-alerts/test');
  ok(test.in_app > 0, 'vehicle alerts test');

  console.log('usage (read-only; purchase routes are not part of the app)');
  const ov = await request<any>('GET', '/v1/tenant/billing/overview');
  ok(ov.subscription.status === 'active' && ov.meters.length > 0, 'overview');
  await expectError(request('GET', '/v1/tenant/billing/invoices'), 'NOT_FOUND', 'invoices not mocked');
  await expectError(request('GET', '/v1/tenant/billing/orders'), 'NOT_FOUND', 'orders not mocked');

  console.log('letterhead');
  const st = await request<any>('GET', '/v1/tenant/settings');
  ok(st.company_name && st.paper_size === 'A4', 'settings');
  const st2 = await request<any>('PATCH', '/v1/tenant/settings', { body: { tagline: 'Test', primary_color: '#2563eb', paper_size: 'A3' } });
  ok(st2.tagline === 'Test' && st2.primary_color === '#2563EB' && st2.paper_size === 'A3', 'settings patched');
  await expectError(request('PATCH', '/v1/tenant/settings', { body: { primary_color: 'red' } }), 'VALIDATION_ERROR', 'bad colour rejected');

  console.log('assistant');
  const status = await request<any>('GET', '/v1/tenant/ai/status');
  ok(status.available, 'assistant available');
  const conv = await request<any>('POST', '/v1/tenant/ai/conversations', { body: {} });
  for (const q of ['Bugün kaç araç teslim ettik?', 'Bu ayın gelir grafiği', 'Kasalarda ne kadar para var?', 'Stoğu azalan ürünler hangileri?', 'En yüksek cari borcu olan müşteriler kimler?', 'merhaba']) {
    const res = await aiService.sendMessage(conv.uuid, q, 'tr');
    ok(res.message.blocks.some((b: any) => b.type === 'text' && b.text), `answer (streamed): ${q} → ${res.message.blocks.map((b: any) => b.type).join(',')}`);
  }
  const list = await request<any>('GET', '/v1/tenant/ai/conversations');
  ok(list.items.length >= 2, `conversations: ${list.items.length}`);
  await request('PATCH', `/v1/tenant/ai/conversations/${conv.uuid}`, { body: { title: 'Renamed' } });
  ok((await request<any>('GET', `/v1/tenant/ai/conversations/${conv.uuid}`)).title === 'Renamed', 'renamed');
  await request('DELETE', `/v1/tenant/ai/conversations/${conv.uuid}`);
  await expectError(request('GET', `/v1/tenant/ai/conversations/${conv.uuid}`), 'NOT_FOUND', 'deleted');

  console.log('staff gates');
  await login('personel@otopoly.com');
  ok((await request<any>('GET', '/v1/tenant/messaging/session')).status, 'staff reads session');
  await expectError(request('POST', '/v1/tenant/messaging/session/connect'), 'FORBIDDEN', 'staff cannot connect');
  await expectError(request('GET', '/v1/tenant/daily-summary'), 'FORBIDDEN', 'staff cannot read daily summary');
  await expectError(request('GET', '/v1/tenant/settings'), 'FORBIDDEN', 'staff cannot read letterhead');
  ok((await request<any>('GET', '/v1/tenant/billing/overview')).subscription, 'staff reads billing');

  console.log(failures ? `\n${failures} FAILED` : '\nall settings checks passed');
  process.exit(failures ? 1 : 0);
})();
