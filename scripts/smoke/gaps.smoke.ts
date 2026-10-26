/* Backend gap features smoke test: customer / supplier 360 filters (sales, purchases, contracts), the
 * customer activity feed, AI conversation previews, organization sector, the `tenant.calendar` live
 * resource and brand fields on jobs / quotes / leads — mock API through the real services.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { messagePreview } from '@/api/mock/handlers/ai';
import { session } from '@/api/session';
/* Raw requests for contracts / settings: their services import `@/api/files` (expo-file-system). */
const contractsApi = {
  listTemplates: (query: Record<string, unknown>) => request<any>('GET', '/v1/tenant/contracts/templates', { query: query as never }),
  listInstances: (query: Record<string, unknown>) => request<any>('GET', '/v1/tenant/contracts/instances', { query: query as never }),
  createInstance: (body: Record<string, unknown>) => request<any>('POST', '/v1/tenant/contracts/instances', { body }),
};
const settingsApi = {
  get: () => request<any>('GET', '/v1/tenant/settings'),
  patch: (body: Record<string, unknown>) => request<any>('PATCH', '/v1/tenant/settings', { body }),
};
import { activityDetail, activityHref } from '@/features/customers/lib/activity';
import { customersService, type CustomerActivityEntry } from '@/features/customers/services/customers.service';
import { jobsService } from '@/features/jobs/services/jobs.service';
import { toSectorKey } from '@/features/onboarding/data/sectors';
import { purchasesService } from '@/features/purchases/services/purchases.service';
import { salesService } from '@/features/sales/services/sales.service';
import { suppliersService } from '@/features/suppliers/services/suppliers.service';
import { LIVE_TARGETS, matchesLive } from '@/lib/realtime/live-targets';
import { LIVE_RESOURCES, organizationResourceChannel, type ResourceChangedEvent } from '@/lib/realtime/types';

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
  return me;
}

const entry = (over: Partial<CustomerActivityEntry>): CustomerActivityEntry => ({
  uuid: 'e',
  action: 'jobs.create',
  resource: 'jobs.job',
  subject: 'job',
  resource_uuid: 'r1',
  payload: {},
  actor: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

(async () => {
  console.log('helpers');
  ok(activityHref(entry({})) === '/jobs/r1', 'job entry → job screen');
  ok(activityHref(entry({ subject: 'contract' })) === '/contracts/instances/r1', 'contract entry → contract screen');
  ok(activityHref(entry({ subject: 'cari_entry' }), 'acc') === '/cari/acc' && activityHref(entry({ subject: 'cari_entry' })) === null, 'cari entry → statement (only with an account)');
  ok(activityHref(entry({ subject: 'vehicle' })) === null && activityHref(entry({ action: 'tenant.customer.delete', subject: 'customer' })) === null, 'vehicle / delete entries have no link');
  ok(activityHref(entry({ resource_uuid: null })) === null, 'no record → no link');
  ok(activityDetail(entry({ payload: { name: 'X', plate: '34 AB 12' } })) === '34 AB 12' && activityDetail(entry({ payload: { number: 7 } })) === '7', 'payload detail priority');
  ok(messagePreview([{ type: 'text', text: '- **Bugün** 3 iş, [rapor](https://x)\n\n## Özet' } as never]) === 'Bugün 3 iş, rapor Özet', 'preview strips markdown to one line');
  const long = messagePreview([{ type: 'text', text: 'a'.repeat(200) } as never]);
  ok(Array.from(long).length === 121 && long.endsWith('…'), 'preview capped at 120 characters + …');
  ok(messagePreview([{ type: 'tool_use' } as never], 'eski') === 'eski', 'turn without text keeps the previous preview');
  ok(toSectorKey('film') === 'ppf_tint' && toSectorKey('tyres') === 'tyres' && toSectorKey('bakery') === null && toSectorKey('') === null, 'sector keys (legacy drafts mapped)');

  console.log('live targets');
  ok(LIVE_RESOURCES.every((r) => LIVE_TARGETS[r]) && LIVE_TARGETS['tenant.calendar'].perm === 'tenant.calendar.read', 'tenant.calendar is a live resource (calendar.read)');
  const ev = (uuids: string[]): ResourceChangedEvent[] => [{ resource: 'tenant.calendar', action: 'updated', uuids, truncated: false }];
  ok(matchesLive('tenant.calendar', ['calendar', 'feed', 'a', 'b', 'events'], ev(['E1']), false), 'calendar change refreshes the feeds (calendar screen, Bugün card)');
  ok(matchesLive('tenant.calendar', ['calendar', 'event', 'E1'], ev(['E1']), false) && !matchesLive('tenant.calendar', ['calendar', 'event', 'E2'], ev(['E1']), false), 'event sheet only for the changed event');
  ok(!matchesLive('tenant.calendar', ['jobs', 'list', {}], ev([]), false), 'other modules untouched');
  const job = (uuids: string[]): ResourceChangedEvent[] => [{ resource: 'tenant.jobs', action: 'created', uuids, truncated: false }];
  ok(matchesLive('tenant.jobs', ['customers', 'activity', 'C1', 'list', {}], job(['J1']), false), 'job change refreshes the customer activity feed');
  ok(matchesLive('tenant.sales', ['sales', 'by-customer', 'C1'], job(['S1']), false), 'sale change refreshes the customer sales section');

  await installMockTransport();
  const me = await login('demo@otopoly.com');
  const orgUuid = me.organizations[0].uuid as string;
  ok(me.organizations[0].sector === 'car_wash', `/me organizations carry sector (${me.organizations[0].sector})`);
  const sub = await request<any>('POST', '/v1/realtime/subscription-token', { body: { channel: organizationResourceChannel(orgUuid, 'tenant.calendar') } });
  ok(sub.channel.endsWith(':tenant.calendar'), 'subscription token for tenant.calendar');

  console.log('customer 360');
  const customers = await customersService.list({ limit: 100, offset: 0 });
  let busiest = customers.items[0];
  let best = -1;
  for (const c of customers.items.filter((x) => x.vehicle_count > 0).slice(0, 25)) {
    const jobs = await jobsService.listByCustomer(c.uuid, { limit: 1, offset: 0 });
    if (jobs.total > best) {
      best = jobs.total;
      busiest = c;
    }
  }
  const sales = await salesService.list({ customer_uuid: busiest.uuid, limit: 10, offset: 0 });
  ok(sales.items.every((s) => s.customer_uuid === busiest.uuid), `sales filtered by customer_uuid (${sales.total})`);
  const allSales = await salesService.list({ limit: 1, offset: 0 });
  const anySale = (await salesService.list({ limit: 100, offset: 0 })).items.find((s) => s.customer_uuid);
  if (anySale) {
    const own = await salesService.list({ customer_uuid: anySale.customer_uuid!, limit: 100, offset: 0 });
    ok(own.total > 0 && own.total < allSales.total && own.items.every((s) => s.customer_uuid === anySale.customer_uuid), 'customer_uuid narrows total');
  } else ok(false, 'a sale with a customer in the seed');
  await expectError(salesService.list({ customer_uuid: 'not-a-uuid', limit: 1, offset: 0 }), 'VALIDATION_ERROR', 'malformed customer_uuid');
  const none = await salesService.list({ customer_uuid: '00000000-0000-4000-8000-000000000000', limit: 1, offset: 0 });
  ok(none.total === 0, 'unknown customer matches nothing');

  const jobs = await jobsService.listByCustomer(busiest.uuid, { limit: 10, offset: 0 });
  const jobRow = jobs.items[0];
  ok(jobRow && Boolean(jobRow.brand_name), 'customer jobs rows carry brand_name');
  if (jobRow) {
    const detail = await jobsService.get(jobRow.uuid);
    ok(Boolean(detail.brand_name), 'job detail carries brand_name (brand_logo_url omitted when none)');
    const tpl = (await contractsApi.listTemplates({ is_active: 'true', limit: 10, offset: 0 })).items[0];
    await contractsApi.createInstance({ template_uuid: tpl.uuid, subject_type: 'service_job', subject_uuid: jobRow.uuid, title: 'Smoke sözleşme' });
    const contracts = await contractsApi.listInstances({ customer_uuid: busiest.uuid, limit: 20, offset: 0 });
    const jobUuids = new Set((await jobsService.listByCustomer(busiest.uuid, { limit: 100, offset: 0 })).items.map((j) => j.uuid));
    ok(contracts.total > 0 && contracts.items.every((k: { subject_uuid: string }) => jobUuids.has(k.subject_uuid)), `contracts filtered by the customer's jobs (${contracts.total})`);
    const others = await contractsApi.listInstances({ customer_uuid: '00000000-0000-4000-8000-000000000000' });
    ok(others.total === 0, 'contracts: unknown customer matches nothing');
  }

  console.log('activity');
  const first = await customersService.activity(busiest.uuid, { limit: 5, offset: 0 });
  ok(first.limit === 5 && first.offset === 0 && first.items.length === Math.min(5, first.total), `first page (${first.total} entries)`);
  const sorted = first.items.every((e, i, a) => i === 0 || a[i - 1].created_at >= e.created_at);
  ok(sorted, 'newest first');
  const second = await customersService.activity(busiest.uuid, { limit: 5, offset: 5 });
  const ids = new Set(first.items.map((e) => e.uuid));
  ok(second.items.every((e) => !ids.has(e.uuid)) && second.total === first.total, 'load more: next page, stable ids and total');
  const all = await customersService.activity(busiest.uuid, { limit: 100, offset: 0 });
  const subjects = new Set(all.items.map((e) => e.subject));
  ok(subjects.has('customer') && subjects.has('vehicle') && subjects.has('job') && subjects.has('contract'), `subjects: ${[...subjects].join(', ')}`);
  ok(all.items.every((e) => typeof e.action === 'string' && e.payload && (e.actor === null || e.actor.name)), 'entry shape');
  await expectError(customersService.activity('00000000-0000-4000-8000-000000000000'), 'NOT_FOUND', 'unknown customer → 404');

  console.log('supplier 360');
  const suppliers = await suppliersService.list({ limit: 50, offset: 0 });
  const allPurchases = await purchasesService.list({ limit: 100, offset: 0 });
  const supplier = suppliers.items.find((s) => allPurchases.items.some((p) => p.supplier_uuid === s.uuid)) ?? suppliers.items[0];
  const purchases = await purchasesService.list({ supplier_uuid: supplier.uuid, limit: 10, offset: 0 });
  ok(purchases.items.every((p) => p.supplier_uuid === supplier.uuid), `purchases filtered by supplier_uuid (${purchases.total})`);
  const posted = await purchasesService.list({ supplier_uuid: supplier.uuid, status: 'posted', limit: 100, offset: 0 });
  ok(posted.items.every((p) => p.status === 'posted'), 'posted purchases for the totals');
  await expectError(purchasesService.list({ supplier_uuid: 'x', limit: 1, offset: 0 }), 'VALIDATION_ERROR', 'malformed supplier_uuid');

  console.log('brands on quotes / leads');
  const quotes = await request<any>('GET', '/v1/tenant/quotes', { query: { limit: 100, offset: 0 } });
  const quoteWithVehicle = quotes.items.find((q: any) => q.vehicle_plate && q.vehicle_brand_name);
  ok(quoteWithVehicle && 'vehicle_brand_logo_url' in quoteWithVehicle, 'quote rows carry vehicle_brand_name / logo');
  if (quoteWithVehicle) {
    const q = await request<any>('GET', `/v1/tenant/quotes/${quoteWithVehicle.uuid}`);
    ok(q.vehicle_brand_name === quoteWithVehicle.vehicle_brand_name, 'quote detail carries the brand');
  }
  const leads = await request<any>('GET', '/v1/tenant/leads', { query: { limit: 100, offset: 0 } });
  const leadWithVehicle = leads.items.find((l: any) => l.vehicle_plate);
  ok(!leadWithVehicle || Boolean(leadWithVehicle.vehicle_brand_name), 'lead rows carry vehicle_brand_name');

  console.log('assistant previews');
  const convs = await request<any>('GET', '/v1/tenant/ai/conversations');
  const seeded = convs.items[0];
  ok(seeded && seeded.last_message_preview.length > 0 && seeded.last_message_at, 'seeded conversation has a preview and last_message_at');
  const fresh = await request<any>('POST', '/v1/tenant/ai/conversations', { body: { title: 'Boş' } });
  ok(fresh.last_message_preview === '' && fresh.last_message_at === null, 'empty conversation: "" preview, null time');

  console.log('sector');
  const settings = await settingsApi.get();
  ok(settings.sector === 'car_wash', 'settings carry sector');
  const patched = await settingsApi.patch({ sector: 'detailing' });
  ok(patched.sector === 'detailing', 'PATCH sets sector');
  const me2 = await request<any>('GET', '/v1/auth/me');
  ok(me2.organizations[0].sector === 'detailing', '/me follows the new sector');
  ok((await settingsApi.patch({ company_name: patched.company_name })).sector === 'detailing', 'omitted sector is kept');
  ok((await settingsApi.patch({ sector: '' })).sector === null, '"" clears sector');
  await expectError(settingsApi.patch({ sector: 'bakery' } as never), 'VALIDATION_ERROR', 'invalid sector → 400');

  console.log(failures ? `FAILED (${failures})` : 'ALL GAP CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
