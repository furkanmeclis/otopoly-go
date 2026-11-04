/* Stock reorder smoke test: pure helpers (stepper, grouping, draft body, deep links) and the mock API rules
 * (formula, filters, settings, overrides, drafts → post / delete, permissions, plan gate) through the real services.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { setPlanScenario } from '@/api/mock/scenario';
import { session } from '@/api/session';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { financeService } from '@/features/finance/services/finance.service';
import { notificationTarget, resolveWebPath } from '@/features/notifications/deep-links';
import { purchasesService } from '@/features/purchases/services/purchases.service';
import { draftItems, groupBySupplier, missingSupplier, qtyString, stepQty, stockFill, urgencyTone } from '@/features/stock-reorder/lib/reorder';
import { stockReorderService } from '@/features/stock-reorder/services/stock-reorder.service';
import type { ReorderSuggestion } from '@/features/stock-reorder/types';

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

const sug = (over: Partial<ReorderSuggestion>): ReorderSuggestion => ({
  product_uuid: 'p',
  name: 'P',
  sku: '',
  unit: 'piece',
  currency: 'TRY',
  urgency: 'none',
  stock: '1',
  min_stock: '2',
  on_order: '0',
  velocity_per_day: '0',
  days_of_cover: null,
  suggested_qty: '1',
  pack_size: null,
  packs: null,
  supplier: null,
  unit_cost: '10.00',
  unit_cost_source: 'cost_price',
  estimated_total: '10.00',
  last_purchased_at: null,
  inputs: {
    velocity_days: 30,
    consumed_qty: '0',
    sold_qty: '0',
    lead_days: 3,
    lead_days_source: 'organization',
    target_days: 14,
    target_days_source: 'organization',
    demand_qty: '0',
    raw_need: '1',
    formula: '',
  },
  override: null,
  ...over,
});

(async () => {
  console.log('helpers');
  ok(stepQty('3', 1, null) === '4' && stepQty('0', -1, null) === '0' && stepQty('2.5', -1, null) === '2', 'stepper: ±1, never below 0, snaps fractions');
  ok(stepQty('18', 1, '6') === '24' && stepQty('20', 1, '6') === '24' && stepQty('20', -1, '6') === '18' && stepQty('1.5', 1, '0.75') === '2.25', 'stepper: whole packs');
  ok(qtyString(0.1 + 0.2) === '0.3' && qtyString(-1) === '0', 'qty string without float noise');
  const a = sug({ product_uuid: 'a', supplier: { uuid: 's2', name: 'Zeta', source: 'last_purchase' }, suggested_qty: '2' });
  const b = sug({ product_uuid: 'b', supplier: { uuid: 's1', name: 'Alfa', source: 'product' } });
  const c = sug({ product_uuid: 'c' });
  const sections = groupBySupplier([c, a, b], (s) => (s.product_uuid === 'a' ? '3' : s.suggested_qty), 'Yok');
  ok(sections.map((s) => s.title).join(',') === 'Alfa,Zeta,Yok' && sections[1].total === 30, 'grouped by supplier A→Z, no supplier last, totals use edited qty');
  const picked = new Set(['a', 'c']);
  ok(JSON.stringify(draftItems([a, b, c], picked, (s) => (s.product_uuid === 'c' ? '0' : s.suggested_qty))) === JSON.stringify([{ product_uuid: 'a', qty: '2' }]), 'draft body: selected rows with qty > 0');
  ok(missingSupplier([a, b, c], picked).map((s) => s.product_uuid).join() === 'c', 'selected rows without supplier are reported');
  ok(stockFill({ stock: '2', min_stock: '2' }) === 0.5 && stockFill({ stock: '-1', min_stock: '3' }) === 0 && urgencyTone('out_of_stock') === 'danger', 'stock bar and urgency tone');
  ok(resolveWebPath('/t/parlak-oto/purchases/reorder')?.href === '/purchases/reorder', 'deep link: /t/{slug}/purchases/reorder → suggestions');
  ok(resolveWebPath('https://otopoly.app/t/parlak-oto/purchases/reorder?tab=drafts')?.href === '/purchases/reorder/drafts', 'deep link: ?tab=drafts → drafts list');
  ok(notificationTarget('/t/parlak-oto/purchases/reorder')?.kind === 'web', 'push action_url opens the app');

  await installMockTransport();
  console.log('suggestions (owner)');
  await login('demo@otopoly.com');
  const list = await stockReorderService.list();
  ok(list.items.length > 0 && list.total === list.items.length, `suggestions listed (${list.total})`);
  ok(list.items.every((i, k) => k === 0 || ['out_of_stock', 'below_min', 'low_cover', 'none'].indexOf(list.items[k - 1].urgency) <= ['out_of_stock', 'below_min', 'low_cover', 'none'].indexOf(i.urgency)), 'most urgent first');
  const glass = list.items.find((i) => i.name.startsWith('Cam Suyu'));
  ok(glass?.urgency === 'out_of_stock' && Number(glass.suggested_qty) >= 12, 'out-of-stock product with a minimum is suggested at least the minimum');
  const micro = list.items.find((i) => i.name.startsWith('Mikrofiber'));
  ok(micro?.on_order === '10' && micro.urgency === 'below_min', 'draft quantity counts as on order');
  const shampoo = (await stockReorderService.list({ all: true })).items.find((i) => i.name.startsWith('Köpük Şampuan'));
  ok(shampoo?.pack_size === '20' && Number(shampoo.suggested_qty) % 20 === 0 && shampoo.inputs.lead_days_source === 'supplier' && shampoo.inputs.lead_days === 2, 'pack rounding and supplier lead time');
  ok(shampoo?.supplier?.source === 'last_purchase' && shampoo.unit_cost_source === 'last_purchase', 'supplier and cost from the last purchase');
  const filtered = await stockReorderService.list({ urgency: 'out_of_stock' });
  ok(filtered.items.length > 0 && filtered.items.every((i) => i.urgency === 'out_of_stock'), 'urgency filter');
  await expectError(stockReorderService.list({ urgency: 'soon' as never }), 'VALIDATION_ERROR', 'unknown urgency');
  const summary = await stockReorderService.summary();
  ok(summary.urgent === summary.out_of_stock + summary.below_min && summary.urgent > 0 && summary.drafts === 1, `summary: urgent ${summary.urgent}, drafts ${summary.drafts}`);

  console.log('settings / overrides');
  const settings = await stockReorderService.settings();
  ok(settings.velocity_days === 30 && settings.lead_days === 3 && settings.target_days === 14 && settings.notify_time === '09:00', 'defaults (30 / 3 / 14, 09:00)');
  await expectError(stockReorderService.updateSettings({ ...settings, velocity_days: 45 }), 'VALIDATION_ERROR', 'velocity window must be an option');
  const saved = await stockReorderService.updateSettings({ velocity_days: 14, lead_days: 5, target_days: 10, notify_enabled: false, supplier_lead_days: [] });
  ok(saved.velocity_days === 14 && !saved.notify_enabled && saved.supplier_lead_days.length === 0, 'settings saved, supplier lead times replaced');
  await stockReorderService.updateSettings({ velocity_days: 30, lead_days: 3, target_days: 14, notify_enabled: true });
  const product = glass!.product_uuid;
  const ov = await stockReorderService.setProductOverride(product, { pack_size: '6', target_days: 20 });
  ok(ov.override?.pack_size === '6' && ov.override.target_days === 20, 'override saved');
  const after = (await stockReorderService.list()).items.find((i) => i.product_uuid === product)!;
  ok(Number(after.suggested_qty) % 6 === 0 && after.inputs.target_days_source === 'product', 'override applies (pack 6, target from product)');
  ok((await stockReorderService.productOverride(product)).override?.pack_size === '6', 'override read back');
  ok((await stockReorderService.clearProductOverride(product)).deleted && (await stockReorderService.productOverride(product)).override === null, 'override removed');
  await stockReorderService.setProductOverride(product, { lead_days: 1 });
  ok((await stockReorderService.setProductOverride(product, {})).override === null, 'empty override clears it');

  console.log('drafts');
  const suppliers = await request<any>('GET', '/v1/tenant/suppliers', { query: { limit: 20, offset: 0, is_active: 'true' } });
  const supplier = (suppliers.items as any[]).find((x) => x.uuid !== shampoo!.supplier?.uuid).uuid as string;
  await expectError(stockReorderService.createDrafts({ items: [] }), 'VALIDATION_ERROR', 'empty selection');
  const noSupplier = (await stockReorderService.list({ all: true })).items.find((i) => !i.supplier);
  if (noSupplier) await expectError(stockReorderService.createDrafts({ items: [{ product_uuid: noSupplier.product_uuid, qty: '1' }] }), 'VALIDATION_ERROR', 'a supplier is required');
  const before = Number((await catalogService.getProduct(product)).stock_quantity);
  const created = await stockReorderService.createDrafts({
    items: [
      { product_uuid: product, qty: '12', supplier_uuid: supplier },
      { product_uuid: shampoo!.product_uuid, qty: '20' },
    ],
  });
  ok(created.drafts.length === 2 && created.drafts.every((d) => d.status === 'draft'), 'one draft per supplier');
  ok(Number((await catalogService.getProduct(product)).stock_quantity) === before, 'drafts do not change stock');
  const drafts = await purchasesService.list({ limit: 20, offset: 0, status: 'draft' });
  const regular = await purchasesService.list({ limit: 100, offset: 0 });
  ok(drafts.total === 3 && !regular.items.some((p) => p.status === 'draft'), 'drafts only with status=draft');
  const accounts = await financeService.listAccounts({ limit: 20, offset: 0 } as never);
  const account = (accounts.items as any[]).find((x) => x.is_default) ?? accounts.items[0];
  const draft = created.drafts.find((d) => d.supplier_uuid === supplier)!;
  const balance0 = Number((accounts.items as any[]).find((x) => x.uuid === account.uuid).current_balance);
  await expectError(stockReorderService.postDraft(draft.uuid, { method: 'cash' } as never), 'VALIDATION_ERROR', 'posting needs an account');
  const posted = await stockReorderService.postDraft(draft.uuid, { method: 'card', finance_account_uuid: account.uuid, lines: [{ product_uuid: product, qty: '10', unit_cost: '40' }] });
  ok(posted.status === 'posted' && posted.method === 'card' && posted.total_amount === '400.00' && posted.finance_transaction_uuid, 'posted with edited qty / cost');
  ok(Number((await catalogService.getProduct(product)).stock_quantity) === before + 10, 'posting adds the received quantity to stock');
  const balance1 = Number((await financeService.listAccounts({ limit: 20, offset: 0 } as never)).items.find((x: any) => x.uuid === account.uuid)!.current_balance);
  ok(Math.abs(balance0 - 400 - balance1) < 0.01, 'expense booked on the account');
  await expectError(stockReorderService.postDraft(draft.uuid, { method: 'cash', finance_account_uuid: account.uuid }), 'CONFLICT', 'a posted purchase cannot be posted again');
  await expectError(stockReorderService.deleteDraft(draft.uuid), 'CONFLICT', 'a posted purchase cannot be deleted');
  const other = created.drafts.find((d) => d.uuid !== draft.uuid)!;
  ok((await stockReorderService.deleteDraft(other.uuid)).deleted, 'delete answers deleted: true');
  ok((await purchasesService.list({ limit: 20, offset: 0, status: 'draft' })).total === 1, 'draft deleted');

  console.log('staff');
  await login('personel@otopoly.com');
  const staffList = await stockReorderService.list();
  ok(staffList.items.length > 0, 'staff can read suggestions');
  await expectError(stockReorderService.createDrafts({ items: [{ product_uuid: product, qty: '1', supplier_uuid: supplier }] }), 'FORBIDDEN', 'staff cannot create drafts');
  await expectError(stockReorderService.updateSettings({ velocity_days: 30, lead_days: 3, target_days: 14, notify_enabled: true }), 'FORBIDDEN', 'staff cannot change settings');

  console.log('plan gate');
  await login('demo@otopoly.com');
  await setPlanScenario('feature_disabled');
  await expectError(stockReorderService.summary(), 'FEATURE_DISABLED', 'module off → 403 FEATURE_DISABLED');
  await setPlanScenario('normal');
  ok((await stockReorderService.summary()).urgent >= 0, 'back on with the normal plan');

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
