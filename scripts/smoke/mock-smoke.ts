/* End-to-end smoke test of the mock API through the real client (node, no RN). */
import { request } from '@/api/client';
import { session } from '@/api/session';
import { installMockTransport } from '@/api/mock';
import { getLogEntries } from '@/lib/logger';

let failures = 0;
const ok = (cond: unknown, msg: string) => { if (!cond) { failures++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
async function expectError(p: Promise<unknown>, code: string, msg: string) {
  try { await p; ok(false, `${msg} (expected ${code}, got success)`); }
  catch (e) { ok((e as { code?: string }).code === code, `${msg} → ${(e as { code?: string }).code}`); }
}

async function login(email: string) {
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const org = me.organizations[0];
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: org.slug } });
  await session.setTokens(t2, org.slug);
  return me;
}

(async () => {
  await installMockTransport();
  console.log('auth');
  await expectError(request('POST', '/v1/auth/login', { body: { email: 'demo@otopoly.com', password: 'x' }, anonymous: true }), 'INVALID_CREDENTIALS', 'wrong password rejected');
  const me = await login('demo@otopoly.com');
  ok(me.permissions.length === 61, `owner has 61 permissions (57 + calendar read/write 000085 + reviews read/write 000096) (${me.permissions.length})`);
  ok(me.organizations[0].role === 'owner', 'owner membership');

  console.log('dashboard data');
  const summary = await request<any>('GET', '/v1/tenant/jobs/summary');
  ok(summary.job_count > 0, `today jobs: ${summary.job_count}, net ${summary.net_total}`);
  const board = await request<any>('GET', '/v1/tenant/jobs', { query: { status: 'in_progress', limit: 100 } });
  ok(board.items.length > 0, `open board jobs: ${board.items.length}`);
  const overview = await request<any>('GET', '/v1/tenant/reports/overview');
  ok(overview.timeseries.length === 30, `30-day series (${overview.timeseries.length}), income ${overview.kpis.total_income}`);

  console.log('job lifecycle');
  const customers = await request<any>('GET', '/v1/tenant/customers', { query: { q: '', limit: 5 } });
  const cust = await request<any>('GET', `/v1/tenant/customers/${customers.items[0].uuid}`);
  const services = await request<any>('GET', '/v1/tenant/catalog/services', { query: { is_active: 'true', limit: 3 } });
  const job = await request<any>('POST', '/v1/tenant/jobs', { body: { customer_uuid: cust.uuid, vehicle_uuid: cust.vehicles[0].uuid, lines: [{ service_uuid: services.items[0].uuid }] } });
  ok(job.status === 'in_progress' && job.payment_status === 'unpaid', 'job created in_progress/unpaid');
  await expectError(request('POST', `/v1/tenant/jobs/${job.uuid}/void`), 'CONFLICT', 'void unpaid job rejected');
  const ready = await request<any>('POST', `/v1/tenant/jobs/${job.uuid}/ready`);
  ok(ready.status === 'ready', 'ready');
  await expectError(request('POST', `/v1/tenant/jobs/${job.uuid}/ready`), 'CONFLICT', 'ready twice rejected');
  const accounts = await request<any>('GET', '/v1/tenant/finance/accounts');
  const cash = accounts.items.find((a: any) => a.type === 'cash');
  const before = Number(cash.current_balance);
  const closed = await request<any>('POST', `/v1/tenant/jobs/${job.uuid}/close`, { body: { method: 'cash', finance_account_uuid: cash.uuid } });
  ok(closed.payment_status === 'paid', 'closed paid');
  const cashAfter = (await request<any>('GET', `/v1/tenant/finance/accounts/${cash.uuid}`)).current_balance;
  ok(Math.abs(Number(cashAfter) - before - Number(job.total_amount)) < 0.01, `cash balance +${job.total_amount}`);
  const voided = await request<any>('POST', `/v1/tenant/jobs/${job.uuid}/void`);
  ok(voided.status === 'voided', 'owner voids paid job');
  const cashVoid = (await request<any>('GET', `/v1/tenant/finance/accounts/${cash.uuid}`)).current_balance;
  ok(Math.abs(Number(cashVoid) - before) < 0.01, 'cash balance restored after void');

  console.log('validation');
  await expectError(request('POST', '/v1/tenant/jobs', { body: {} }), 'VALIDATION_ERROR', 'empty job rejected');
  await expectError(request('GET', '/v1/tenant/jobs/nope'), 'NOT_FOUND', 'unknown job 404');

  console.log('quotes');
  const quote = await request<any>('POST', '/v1/tenant/quotes', { body: { customer_uuid: cust.uuid, vehicle: { vehicle_uuid: cust.vehicles[0].uuid }, discount_type: 'percent', discount_value: '10', lines: [{ line_type: 'service', service_uuid: services.items[0].uuid, quantity: '2' }] } });
  ok(quote.number.startsWith('TKL-'), `quote ${quote.number} total ${quote.grand_total}`);
  const sent = await request<any>('POST', `/v1/tenant/quotes/${quote.uuid}/send`, { body: { channel: 'whatsapp' } });
  ok(sent.quote.status === 'sent' && sent.delivery.status === 'sent', 'quote sent');
  const preview = await request<any>('GET', `/v1/tenant/quotes/${quote.uuid}/convert`);
  ok(preview.can_convert && preview.will_accept, 'convert preview (will accept)');
  const conv = await request<any>('POST', `/v1/tenant/quotes/${quote.uuid}/convert`, { body: {} });
  ok(conv.job_uuid && conv.quote.status === 'accepted', 'converted to job');

  console.log('staff permissions');
  await login('personel@otopoly.com');
  const staffMe = await request<any>('GET', '/v1/auth/me');
  ok(staffMe.permissions.length === 37, `staff has 37 permissions (34 + calendar read/write + reviews read) (${staffMe.permissions.length})`);
  await expectError(request('POST', '/v1/tenant/finance/transactions', { body: { type: 'expense' } }), 'FORBIDDEN', 'staff cannot write finance');
  await expectError(request('POST', `/v1/tenant/jobs/${conv.job_uuid}/void`), 'FORBIDDEN', 'staff cannot void');
  const staffJob = await request<any>('POST', `/v1/tenant/jobs/${conv.job_uuid}/ready`);
  ok(staffJob.status === 'ready', 'staff can move job');

  console.log('todos/leads');
  const todos = await request<any>('GET', '/v1/tenant/todos/summary');
  ok(todos.open > 0, `todo summary open=${todos.open} overdue=${todos.overdue}`);
  const leads = await request<any>('GET', '/v1/tenant/leads', { query: { limit: 50 } });
  ok(leads.items.length > 0, `leads ${leads.items.length}`);

  const errors = getLogEntries().filter((e) => e.level === 'error');
  ok(errors.length === 0, `no error-level logs (${errors.length})`);
  errors.forEach((e) => console.log('   ', e.scope, e.message, JSON.stringify(e.data).slice(0, 300)));
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
