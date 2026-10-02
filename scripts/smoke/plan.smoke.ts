/* Plan usage & limits smoke test: mock scenarios, LIMIT_REACHED / FEATURE_DISABLED through the real
 * client and API error bus, and the role-based copy. Run via `npm run test:smoke`. */
import { request } from '@/api/client';
import { ApiError, isApiError, isFeatureDisabled, isLimitReached, limitInfo } from '@/api/errors';
import { subscribeApiEvents } from '@/api/events';
import { installMockTransport } from '@/api/mock';
import { setPlanScenario } from '@/api/mock/scenario';
import { session } from '@/api/session';
import { featureSlug, limitReachedMessage, meterTone, moduleName, PLAN_FEATURES, usagePercent, usageTone } from '@/features/billing/lib';
import { translate, type AppLocale } from '@/lib/i18n/translate';
import { catalogs } from '@/locales';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function caught(p: Promise<unknown>): Promise<ApiError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return isApiError(e) ? e : null;
  }
}
async function login(email: string) {
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
}
const meter = (ov: any, key: string) => ov.meters.find((m: any) => m.key === key);
const tr = (locale: AppLocale) => (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
const PURCHASE_WORDS = /yükselt|satın|fiyat|ödeme|abone ol|upgrade|purchase|buy|price|subscribe|payment/i;

(async () => {
  await installMockTransport();

  console.log('helpers');
  ok(usageTone(79, 100) === 'ok' && usageTone(80, 100) === 'warn' && usageTone(100, 100) === 'full' && usageTone(120, 100) === 'full', 'tone: ok < 80 % ≤ warn < 100 % ≤ full');
  ok(usageTone(5000, null) === 'ok' && usagePercent(5, null) === 0 && usagePercent(3, 4) === 75, 'unlimited is ok / 0 %');
  const details = limitInfo(
    new ApiError({
      status: 409,
      code: 'LIMIT_REACHED',
      message: 'x',
      details: [
        { field: 'feature', message: 'customers.count' },
        { field: 'limit', message: '2500' },
        { field: 'used', message: '2500' },
      ],
    }),
  );
  ok(details.feature === 'customers.count' && details.limit === 2500 && details.used === 2500, 'limitInfo reads the details list');

  console.log('copy (tr/en, owner/staff)');
  for (const locale of ['tr', 'en'] as const) {
    const t = tr(locale);
    const mobile = catalogs[locale].mobile as Record<string, string>;
    for (const who of ['owner', 'staff'])
      for (const p of ['day', 'month', 'total']) ok(mobile[`plan.limit.${who}_${p}`], `${locale} plan.limit.${who}_${p}`);
    for (const f of PLAN_FEATURES) {
      const key = f.endsWith('.enabled') || f.startsWith('module.') ? `plan.module.${featureSlug(f)}` : `plan.feature.${featureSlug(f)}`;
      ok(mobile[key], `${locale} ${key}`);
    }
    const plan = Object.entries(mobile).filter(([k]) => k.startsWith('plan.') && !k.startsWith('plan.scenario.'));
    ok(!plan.some(([, v]) => PURCHASE_WORDS.test(v)), `${locale}: no purchase / upgrade wording in plan copy`);
    ok(moduleName(t, 'module.contracts') !== 'module.contracts', `${locale}: module name resolves`);
  }
  const owner = limitReachedMessage(tr('tr'), { isOwner: true, feature: 'jobs.monthly', used: 300, limit: 300, ownerNotified: true });
  ok(owner === 'Aylık işlem limitinize ulaştınız (300/300). Ayrıntıları e-posta adresinize gönderdik.', `owner tr: ${owner}`);
  const staff = limitReachedMessage(tr('tr'), { isOwner: false, feature: 'whatsapp.monthly', used: 1000, limit: 1000, ownerNotified: true });
  ok(staff === 'İşletmenizin aylık WhatsApp mesajı limiti doldu. İşletme yöneticinize bilgi verildi.', `staff tr: ${staff}`);
  ok(limitReachedMessage(tr('en'), { isOwner: true, feature: 'customers.count', used: 2500, limit: 2500, ownerNotified: true }).startsWith("You've reached your total customer record limit (2500/2500)"), 'owner en (total)');
  ok(limitReachedMessage(tr('tr'), { isOwner: true, feature: 'jobs.daily', used: 60, limit: 60, ownerNotified: true }).startsWith('Günlük işlem limitinize'), 'owner tr (daily)');
  // owner_notified "false" (or missing): nobody was e-mailed, so neither copy may claim it.
  for (const locale of ['tr', 'en'] as const) {
    for (const isOwner of [true, false]) {
      for (const ownerNotified of [false, undefined]) {
        const text = limitReachedMessage(tr(locale), { isOwner, feature: 'jobs.monthly', used: 300, limit: 300, ownerNotified });
        ok(!/e-posta|email|bilgi verildi|notified/i.test(text) && !text.includes('mobile.plan'), `${locale} ${isOwner ? 'owner' : 'staff'} owner_notified=${ownerNotified}: ${text}`);
      }
    }
  }

  await login('demo@otopoly.com');
  const customers = await request<any>('GET', '/v1/tenant/customers', { query: { limit: 5 } });
  const cust = await request<any>('GET', `/v1/tenant/customers/${customers.items[0].uuid}`);
  const services = await request<any>('GET', '/v1/tenant/catalog/services', { query: { is_active: 'true', limit: 3 } });
  const jobBody = { customer_uuid: cust.uuid, vehicle_uuid: cust.vehicles[0].uuid, lines: [{ service_uuid: services.items[0].uuid }] };
  const quoteBody = { customer_uuid: cust.uuid, vehicle: { vehicle_uuid: cust.vehicles[0].uuid }, lines: [{ line_type: 'service', service_uuid: services.items[0].uuid, quantity: '1' }] };

  console.log('scenario: normal');
  setPlanScenario('normal');
  let ov = await request<any>('GET', '/v1/tenant/billing/overview');
  ok(ov.subscription.plan_name && ov.open_order === null, 'overview has plan, open_order null (backend always sends the key)');
  ok(PLAN_FEATURES.every((k) => meter(ov, k)), 'every backend feature key has a meter');
  ok(meter(ov, 'jobs.monthly').limit === null, 'jobs.monthly unlimited');
  ok(ov.meters.filter((m: any) => m.kind === 'limit').every((m: any) => meterTone(m) === 'ok'), 'all limits ok');
  ok((await request<any>('POST', '/v1/tenant/jobs', { body: jobBody })).uuid, 'job create works');

  console.log('scenario: near_limit (≥ 80 %)');
  setPlanScenario('near_limit');
  ov = await request<any>('GET', '/v1/tenant/billing/overview');
  for (const k of ['jobs.daily', 'customers.count', 'staff.count', 'whatsapp.monthly']) ok(meterTone(meter(ov, k)) === 'warn', `${k} warn (${meter(ov, k).used}/${meter(ov, k).limit})`);
  ok((await request<any>('POST', '/v1/tenant/customers', { body: { name: 'Near Limit' } })).uuid, 'customer create still works');

  console.log('scenario: at_limit');
  setPlanScenario('at_limit');
  ov = await request<any>('GET', '/v1/tenant/billing/overview');
  for (const k of ['jobs.daily', 'customers.count', 'staff.count', 'whatsapp.monthly']) ok(meterTone(meter(ov, k)) === 'full', `${k} full`);
  const events: ApiError[] = [];
  const off = subscribeApiEvents((e) => events.push(e));
  const jobErr = await caught(request('POST', '/v1/tenant/jobs', { body: jobBody }));
  ok(isLimitReached(jobErr) && jobErr.status === 409, 'job create → 409 LIMIT_REACHED');
  ok(jobErr && limitInfo(jobErr).feature === 'jobs.daily' && limitInfo(jobErr).used === 60 && limitInfo(jobErr).limit === 60, 'details: jobs.daily 60/60');
  const custErr = await caught(request('POST', '/v1/tenant/customers', { body: { name: 'Over' } }));
  ok(isLimitReached(custErr) && limitInfo(custErr!).feature === 'customers.count', 'customer create → LIMIT_REACHED customers.count');
  const quote = await request<any>('POST', '/v1/tenant/quotes', { body: quoteBody });
  ok(quote.uuid, 'quote create is not limited (no backend quote counter)');
  const convErr = await caught(request('POST', `/v1/tenant/quotes/${quote.uuid}/convert`, { body: {} }));
  ok(isLimitReached(convErr) && limitInfo(convErr!).feature === 'jobs.daily', 'quote → job convert → LIMIT_REACHED jobs.daily');
  const staffErr = await caught(request('POST', '/v1/tenant/staff', { body: { name: 'A', surname: 'B', email: 'limit@x.com', password: 'Smoke1234' } }));
  ok(isLimitReached(staffErr) && limitInfo(staffErr!).feature === 'staff.count', 'staff create → LIMIT_REACHED staff.count');
  ok(events.filter((e) => e.code === 'LIMIT_REACHED').length === 4, 'every limit error reached the API error bus (dialog trigger)');
  off();
  ok((await request<any>('GET', '/v1/tenant/jobs', { query: { limit: 1 } })).items, 'reads still work at the limit');

  console.log('scenario: at_limit as staff');
  await login('personel@otopoly.com');
  const staffJobErr = await caught(request('POST', '/v1/tenant/jobs', { body: jobBody }));
  ok(isLimitReached(staffJobErr), 'staff job create → LIMIT_REACHED');
  const staffCreate = await caught(request('POST', '/v1/tenant/staff', { body: { name: 'A', surname: 'B', email: 'x@x.com', password: 'Smoke1234' } }));
  ok(staffCreate?.code === 'FORBIDDEN', 'permission errors win over limits (staff → staff create: FORBIDDEN)');
  ok((await request<any>('GET', '/v1/tenant/billing/overview')).meters.length, 'staff reads usage');

  console.log('scenario: feature_disabled (staff, then owner)');
  setPlanScenario('feature_disabled');
  for (const [path, label] of [
    ['/v1/tenant/reports/overview', 'reports'],
    ['/v1/tenant/contracts/instances', 'contracts'],
    ['/v1/tenant/contracts/templates', 'contract templates'],
    ['/v1/tenant/ai/conversations', 'assistant'],
  ]) {
    const e = await caught(request('GET', path));
    ok(isFeatureDisabled(e) && e.status === 403, `${label} → 403 FEATURE_DISABLED`);
  }
  const ai = await request<any>('GET', '/v1/tenant/ai/status');
  ok(ai.plan_enabled === false && ai.available === false && ai.reason === 'plan_disabled', 'ai status reports plan_disabled');
  await login('demo@otopoly.com');
  ov = await request<any>('GET', '/v1/tenant/billing/overview');
  ok(meter(ov, 'module.contracts').enabled === false && meter(ov, 'module.reports').enabled === false && meter(ov, 'ai.enabled').enabled === false, 'overview shows modules off');
  ok(meter(ov, 'module.quotes').enabled === true, 'other modules stay on');
  ok(isFeatureDisabled(await caught(request('GET', '/v1/tenant/reports/overview'))), 'owner reports → FEATURE_DISABLED');
  ok((await request<any>('POST', '/v1/tenant/jobs', { body: jobBody })).uuid, 'limits are fine in this scenario');

  setPlanScenario('normal');
  ok((await request<any>('GET', '/v1/tenant/reports/overview')).kpis, 'back to normal: reports load');

  console.log(failures ? `\n${failures} FAILED` : '\nall plan checks passed');
  process.exit(failures ? 1 : 0);
})();
