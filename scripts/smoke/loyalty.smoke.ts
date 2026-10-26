/* Loyalty smoke test: mock API rules (campaigns / packages / plans CRUD + validation, package sale and cancel with
 * the finance posting, job apply / revert, covered close, stamp earn / reverse, subscriptions with periods and
 * payments, plan gating, staff permissions) through the real service, plus the pure label helpers.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { setPlanScenario } from '@/api/mock/scenario';
import { session } from '@/api/session';
import { jobsService } from '@/features/jobs/services/jobs.service';
import { renewalLabel, rewardLabel, planUsesLabel } from '@/features/loyalty/lib/labels';
import { loyaltyService } from '@/features/loyalty/services/loyalty.service';
import { catalogs } from '@/locales';

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

const tr = (locale: 'tr' | 'en') => (key: string, params?: Record<string, string | number>) => {
  const dot = key.indexOf('.');
  const ns = (catalogs[locale] as Record<string, Record<string, string>>)[key.slice(0, dot)];
  let s = ns?.[key.slice(dot + 1)] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) s = s.replace(`{{${k}}}`, String(v));
  return s;
};

(async () => {
  console.log('helpers');
  const t = tr('tr');
  ok(renewalLabel(t, 0) === 'bugün' && renewalLabel(t, 3) === '3 gün sonra' && renewalLabel(t, -2) === '2 gün gecikti', 'renewal labels');
  ok(rewardLabel(t, (v) => `₺${v}`, { reward_type: 'percent', reward_value: '20.00' }) === '%20 indirim', 'percent reward label');
  ok(rewardLabel(t, (v) => `₺${v}`, { reward_type: 'free_service', reward_value: '0', reward_service: { uuid: 'x', name: 'Yıkama' } }) === 'Ücretsiz Yıkama', 'free service label');
  ok(planUsesLabel(t, { period_months: 1 }) === 'Her 1 ayda sınırsız kullanım', 'unlimited plan label');
  for (const locale of ['tr', 'en'] as const) ok((catalogs[locale].mobile as Record<string, string>)['plan.module.loyalty_enabled'], `${locale}: plan module name`);

  await installMockTransport();
  await login('demo@otopoly.com');

  console.log('programs');
  const ov = await loyaltyService.overview(7);
  ok(ov.active_campaigns >= 1 && ov.active_packages >= 1 && ov.active_plans >= 1, `seeded programs (${ov.active_campaigns}/${ov.active_packages}/${ov.active_plans})`);
  ok(ov.subscriptions_past_due >= 1 && ov.renewals.length >= 1, 'seeded renewals (past due + upcoming)');
  const services = (await request<any>('GET', '/v1/tenant/catalog/services', { query: { limit: 100, offset: 0 } })).items as { uuid: string; code: string; price: string; category_uuid: string }[];
  const full = services.find((s) => s.code === 'YKM-02')!;
  const ext = services.find((s) => s.code === 'YKM-01')!;
  await expectError(loyaltyService.createCampaign({ name: 'X', stamps_required: 5, reward_type: 'percent', reward_value: '10' }), 'VALIDATION_ERROR', 'campaign without eligibility');
  await expectError(loyaltyService.createCampaign({ name: 'X', stamps_required: 5, reward_type: 'percent', reward_value: '150', service_uuids: [full.uuid] }), 'VALIDATION_ERROR', 'percent above 100');
  await expectError(loyaltyService.createCampaign({ name: 'X', stamps_required: 5, reward_type: 'free_service', service_uuids: [full.uuid] }), 'VALIDATION_ERROR', 'free service without reward service');
  const camp = await loyaltyService.createCampaign({ name: 'Dış yıkama kartı', stamps_required: 2, reward_type: 'fixed', reward_value: '50', service_uuids: [ext.uuid] });
  ok(camp.services[0].uuid === ext.uuid && camp.reward_value === '50.00' && camp.is_active, 'campaign created');
  const edited = await loyaltyService.updateCampaign(camp.uuid, { name: 'Dış yıkama kartı', stamps_required: 2, reward_type: 'fixed', reward_value: '60', service_uuids: [ext.uuid], per_customer_limit: 1 });
  ok(edited.reward_value === '60.00' && edited.per_customer_limit === 1, 'campaign updated');
  await expectError(loyaltyService.createPackage({ name: 'P', price: '100', items: [] }), 'VALIDATION_ERROR', 'package without items');
  const pkg = await loyaltyService.createPackage({ name: '3 iç-dış yıkama', price: '1000', validity_days: 30, items: [{ service_uuid: full.uuid, quantity: 3 }] });
  ok(pkg.list_value === (Number(full.price) * 3).toFixed(2) && pkg.sold_count === 0 && pkg.validity_days === 30, 'package created (list value, validity)');
  const plan = await loyaltyService.createPlan({ name: 'Ayda 2 dış yıkama', price: '300', period_months: 1, uses_per_period: 2, service_uuids: [ext.uuid] });
  ok(plan.uses_per_period === 2 && plan.active_count === 0, 'plan created');
  await expectError(loyaltyService.createPlan({ name: 'P', price: '300', period_months: 13, service_uuids: [ext.uuid] }), 'VALIDATION_ERROR', 'period above 12 months');
  const tmpPkg = await loyaltyService.createPackage({ name: 'Geçici', price: '10', items: [{ service_uuid: ext.uuid, quantity: 1 }] });
  ok((await loyaltyService.updatePackage(tmpPkg.uuid, { name: 'Geçici 2', price: '20', is_active: false, items: [{ service_uuid: ext.uuid, quantity: 2 }] })).items[0].quantity === 2, 'package updated');
  ok((await loyaltyService.deletePackage(tmpPkg.uuid)).deleted, 'package archived');
  const tmpPlan = await loyaltyService.createPlan({ name: 'Geçici plan', price: '10', period_months: 3, category_uuids: [ext.category_uuid] });
  ok((await loyaltyService.updatePlan(tmpPlan.uuid, { name: 'Geçici plan', price: '15', period_months: 6, category_uuids: [ext.category_uuid] })).period_months === 6, 'plan updated');
  ok((await loyaltyService.deletePlan(tmpPlan.uuid)).deleted, 'plan archived');
  const tmpCamp = await loyaltyService.createCampaign({ name: 'Geçici', stamps_required: 3, reward_type: 'percent', reward_value: '10', category_uuids: [ext.category_uuid] });
  ok((await loyaltyService.deleteCampaign(tmpCamp.uuid)).deleted, 'campaign archived');
  ok(!(await loyaltyService.listCampaigns()).items.some((c) => c.uuid === tmpCamp.uuid), 'archived campaign leaves the list');
  await expectError(loyaltyService.updateCampaign(tmpCamp.uuid, { name: 'x', stamps_required: 3, reward_type: 'percent', reward_value: '10', category_uuids: [ext.category_uuid] }), 'NOT_FOUND', 'archived campaign is gone');

  console.log('package sale');
  const customers = (await request<any>('GET', '/v1/tenant/customers', { query: { limit: 50, offset: 0 } })).items as { uuid: string }[];
  let customer: any = null;
  for (const c of customers) {
    const d = await request<any>('GET', `/v1/tenant/customers/${c.uuid}`);
    if (d.vehicles.length) {
      customer = d;
      break;
    }
  }
  ok(customer, 'customer with a vehicle');
  const accounts = (await request<any>('GET', '/v1/tenant/finance/accounts', { query: { limit: 100, offset: 0 } })).items as { uuid: string; type: string; current_balance: string }[];
  const cash = accounts.find((a) => a.type === 'cash')!;
  await expectError(loyaltyService.sellPackage({ package_uuid: pkg.uuid, customer_uuid: customer.uuid, method: 'cash' }), 'VALIDATION_ERROR', 'cash sale needs an account');
  const before = Number(cash.current_balance);
  const sold = await loyaltyService.sellPackage({ package_uuid: pkg.uuid, customer_uuid: customer.uuid, method: 'cash', finance_account_uuid: cash.uuid });
  ok(sold.state === 'active' && sold.credits[0].remaining === 3 && Boolean(sold.expires_at), 'package sold with 3 credits');
  const afterSale = (await request<any>('GET', '/v1/tenant/finance/accounts', { query: { limit: 100, offset: 0 } })).items.find((a: any) => a.uuid === cash.uuid);
  ok(Math.abs(Number(afterSale.current_balance) - before - 1000) < 0.01, 'sale posted to the cash account');
  const txns = (await request<any>('GET', '/v1/tenant/finance/transactions', { query: { limit: 20, offset: 0 } })).items as { source_type?: string; category_name?: string }[];
  ok(txns.some((x) => x.source_type === 'loyalty_package'), 'finance transaction from the package sale');
  const cari = await loyaltyService.sellPackage({ package_uuid: pkg.uuid, customer_uuid: customer.uuid, method: 'cari' });
  const cancelled = await loyaltyService.cancelCustomerPackage(cari.uuid);
  ok(cancelled.refunded && cancelled.state === 'cancelled', 'unused package cancel refunds');
  await expectError(loyaltyService.cancelCustomerPackage(cari.uuid), 'CONFLICT', 'second cancel');

  console.log('job: apply / revert / covered close / stamps');
  const vehicle = customer.vehicles[0].uuid;
  const job = await jobsService.create({ customer_uuid: customer.uuid, vehicle_uuid: vehicle, lines: [{ service_uuid: full.uuid }] } as never);
  let jl = await loyaltyService.jobLoyalty(job.uuid);
  const opt = jl.options.find((o) => o.kind === 'package' && o.source_uuid === sold.uuid);
  ok(jl.editable && opt && opt.units === 1 && opt.remaining === 2, 'package credit offered on the job line');
  await expectError(loyaltyService.applyToJob(job.uuid, { kind: 'package', source_uuid: pkg.uuid, line_uuid: job.lines[0].uuid }), 'NOT_APPLICABLE', 'wrong source → NOT_APPLICABLE');
  jl = await loyaltyService.applyToJob(job.uuid, { kind: 'package', source_uuid: sold.uuid, line_uuid: job.lines[0].uuid });
  let detail = await jobsService.get(job.uuid);
  ok(jl.applied.length === 1 && Number(detail.total_amount) === 0 && detail.lines[0].discount_source === 'package', 'line covered, total 0');
  await expectError(loyaltyService.applyToJob(job.uuid, { kind: 'package', source_uuid: sold.uuid, line_uuid: job.lines[0].uuid }), 'CONFLICT', 'line already covered');
  jl = await loyaltyService.revertOnJob(job.uuid, jl.applied[0].uuid);
  detail = await jobsService.get(job.uuid);
  ok(jl.applied[0].status === 'reverted' && Number(detail.total_amount) === Number(full.price) && !detail.lines[0].discount_source, 'revert restores the line');
  ok((await loyaltyService.getCustomerPackage(sold.uuid)).credits[0].remaining === 3, 'credit returned');
  await loyaltyService.applyToJob(job.uuid, { kind: 'package', source_uuid: sold.uuid, line_uuid: job.lines[0].uuid });
  await jobsService.deliver(job.uuid);
  const closed = await jobsService.close(job.uuid, {});
  ok(closed.payment_status === 'paid' && closed.payments.length === 0, 'covered job closes paid without a payment');
  const stamped = await loyaltyService.jobLoyalty(job.uuid);
  ok(!stamped.editable && stamped.stamps_earned.length === 0, 'a line loyalty covered earns no stamp');
  const cust1 = await loyaltyService.customerLoyalty(customer.uuid);
  const wash = cust1.stamps.find((c) => c.campaign_name.startsWith('5 yıkamaya'))!;
  const paidJob = await jobsService.create({ customer_uuid: customer.uuid, vehicle_uuid: vehicle, lines: [{ service_uuid: full.uuid }] } as never);
  await jobsService.close(paidJob.uuid, { method: 'cash', finance_account_uuid: cash.uuid });
  ok((await loyaltyService.jobLoyalty(paidJob.uuid)).stamps_earned.length === 0, 'paid but not delivered: no stamp yet');
  await jobsService.deliver(paidJob.uuid);
  const earned = await loyaltyService.jobLoyalty(paidJob.uuid);
  ok(earned.stamps_earned.some((c) => c.uuid === wash.campaign_uuid) && !earned.stamps_earned.some((c) => c.uuid === camp.uuid), 'delivered + paid job earned a stamp (wash category only)');
  const cust2 = await loyaltyService.customerLoyalty(customer.uuid);
  ok(cust2.stamps.find((c) => c.campaign_uuid === wash.campaign_uuid)!.balance === wash.balance + 1, 'stamp earned once');
  await jobsService.void(paidJob.uuid);
  await jobsService.void(job.uuid);
  const cust3v = await loyaltyService.customerLoyalty(customer.uuid);
  ok(cust3v.stamps.find((c) => c.campaign_uuid === wash.campaign_uuid)!.balance === wash.balance, 'void reverses the stamp');
  ok((await loyaltyService.getCustomerPackage(sold.uuid)).credits[0].remaining === 3, 'void gives the credit back');

  console.log('stamp reward');
  for (let i = 0; i < 2; i++) {
    const j = await jobsService.create({ customer_uuid: customer.uuid, vehicle_uuid: vehicle, lines: [{ service_uuid: ext.uuid }] } as never);
    await jobsService.deliver(j.uuid);
    await jobsService.close(j.uuid, { method: 'cash', finance_account_uuid: cash.uuid });
  }
  const cust3 = await loyaltyService.customerLoyalty(customer.uuid);
  const card = cust3.stamps.find((c) => c.campaign_uuid === camp.uuid);
  ok(card?.rewards_available === 1 && card.stamps === 0 && card.balance === 2, 'two paid deliveries → one reward ready');
  const rj = await jobsService.create({ customer_uuid: customer.uuid, vehicle_uuid: vehicle, lines: [{ service_uuid: ext.uuid }] } as never);
  const rOpt = (await loyaltyService.jobLoyalty(rj.uuid)).options.find((o) => o.kind === 'reward' && o.source_uuid === camp.uuid);
  ok(rOpt?.discount_amount === Math.min(60, Number(ext.price)).toFixed(2), 'fixed reward offered');
  await loyaltyService.applyToJob(rj.uuid, { kind: 'reward', source_uuid: camp.uuid, line_uuid: rj.lines[0].uuid });
  const cust4 = await loyaltyService.customerLoyalty(customer.uuid);
  const card4 = cust4.stamps.find((c) => c.campaign_uuid === camp.uuid)!;
  ok(card4.rewards_redeemed === 1 && card4.balance === 0 && card4.limit_reached, 'reward redeemed, per-customer limit reached');
  await jobsService.cancel(rj.uuid);
  ok((await loyaltyService.customerLoyalty(customer.uuid)).stamps.find((c) => c.campaign_uuid === camp.uuid)!.balance === 2, 'cancel gives the stamps back');

  console.log('subscriptions');
  await expectError(loyaltyService.startSubscription({ plan_uuid: plan.uuid, customer_uuid: customer.uuid, payment: { method: 'card' } }), 'VALIDATION_ERROR', 'card payment needs an account');
  const unpaid = await loyaltyService.startSubscription({ plan_uuid: plan.uuid, customer_uuid: customer.uuid, vehicle_uuid: vehicle });
  ok(unpaid.state === 'past_due' && !unpaid.current_period && unpaid.payments.length === 0, 'started without payment → past due');
  const paid = await loyaltyService.paySubscription(unpaid.uuid, { method: 'cari' });
  ok(paid.state === 'active' && paid.current_period?.limit === 2 && paid.payments.length === 1 && paid.renewal_date === paid.next_period.start, 'first period collected');
  const sj = await jobsService.create({ customer_uuid: customer.uuid, vehicle_uuid: vehicle, lines: [{ service_uuid: ext.uuid, qty: '3' }] } as never);
  const sOpt = (await loyaltyService.jobLoyalty(sj.uuid)).options.find((o) => o.kind === 'subscription' && o.source_uuid === paid.uuid);
  ok(sOpt?.units === 2 && sOpt.remaining === 0, 'subscription use capped at the period limit');
  await loyaltyService.applyToJob(sj.uuid, { kind: 'subscription', source_uuid: paid.uuid, line_uuid: sj.lines[0].uuid });
  const used = await loyaltyService.getSubscription(paid.uuid);
  ok(used.current_period?.used === 2 && used.current_period.remaining === 0 && used.usage.length === 1, 'uses counted in the period');
  const plans = await loyaltyService.listPlans({ q: 'Ayda 2' });
  ok(plans.items[0]?.active_count === 1, 'plan counts active subscribers');
  const due = await loyaltyService.listSubscriptions({ due_within_days: 7 });
  ok(due.items.every((s) => s.state !== 'cancelled') && due.items.some((s) => s.state === 'past_due'), 'due filter lists past due first');
  const cancelledSub = await loyaltyService.cancelSubscription(paid.uuid);
  ok(cancelledSub.state === 'cancelled', 'subscription cancelled');
  await expectError(loyaltyService.paySubscription(paid.uuid, { method: 'cari' }), 'CONFLICT', 'cannot pay a cancelled subscription');

  console.log('plan / staff');
  setPlanScenario('feature_disabled');
  await expectError(loyaltyService.overview(7), 'FEATURE_DISABLED', 'module off → overview locked');
  await expectError(loyaltyService.customerLoyalty(customer.uuid), 'FEATURE_DISABLED', 'module off → customer section locked');
  await expectError(loyaltyService.jobLoyalty(sj.uuid), 'FEATURE_DISABLED', 'module off → job section locked');
  setPlanScenario('normal');
  await login('personel@otopoly.com');
  ok((await loyaltyService.listCampaigns()).items.length >= 1, 'staff reads campaigns');
  await expectError(loyaltyService.createCampaign({ name: 'S', stamps_required: 2, reward_type: 'fixed', reward_value: '5', service_uuids: [ext.uuid] }), 'FORBIDDEN', 'staff cannot write programs');
  const staffSale = await loyaltyService.sellPackage({ package_uuid: pkg.uuid, customer_uuid: customer.uuid, method: 'cari' });
  ok(staffSale.state === 'active', 'staff may sell (loyalty.apply)');
  await expectError(loyaltyService.cancelCustomerPackage(staffSale.uuid), 'FORBIDDEN', 'staff cannot cancel (loyalty.write)');

  console.log(failures ? `FAILED (${failures})` : 'ALL LOYALTY CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
