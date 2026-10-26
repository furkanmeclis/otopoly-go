/* Contract driver: exercises every area through the real feature services (the request bodies screens send)
 * against the mock, plus the main error cases. Bundled and run by scripts/contract/run.mjs, which records every
 * exchange and validates it against scripts/contract/openapi.yaml. Exits non-zero only when a call the driver
 * expects to succeed fails (contract violations are reported by the validator). */
import { request } from '@/api/client';
import { isApiError } from '@/api/errors';
import { installMockTransport, mockFormRequest } from '@/api/mock';
import { listRoutes } from '@/api/mock/core';
import { DEMO_IDENTITIES, demoIdToken } from '@/api/mock/demo-auth';
import { setPlanScenario } from '@/api/mock/scenario';
import { session, type Tokens } from '@/api/session';
import { authService } from '@/features/account/services/auth.service';
import { identitiesService } from '@/features/account/services/identities.service';
import { notificationPreferencesService } from '@/features/account/services/notification-preferences.service';
import { tenantNotificationPreferencesService } from '@/features/account/services/tenant-notification-preferences.service';
import { aiService } from '@/features/ai/services/ai.service';
import { passwordlessService } from '@/features/auth/services/passwordless.service';
import { billingService } from '@/features/billing/services/billing.service';
import { cariService } from '@/features/cari/services/cari.service';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { contractsService } from '@/features/contracts/services/contracts.service';
import { customersService } from '@/features/customers/services/customers.service';
import { exportSettingsService } from '@/features/export-settings/service';
import { financeService } from '@/features/finance/services/finance.service';
import { exportsService } from '@/features/io/services/exports.service';
import { importsService } from '@/features/io/services/imports.service';
import { exportPath, TENANT_EXPORTS } from '@/features/io/lib/export-resources';
import { TENANT_IMPORTS } from '@/features/io/lib/import-resources';
import { IMPORT_PATHS } from '@/features/io/types';
import { jobsService } from '@/features/jobs/services/jobs.service';
import { leadsService } from '@/features/leads/services/leads.service';
import { loyaltyService } from '@/features/loyalty/services/loyalty.service';
import { dailySummaryService } from '@/features/messaging/services/daily-summary.service';
import { messagingService } from '@/features/messaging/services/messaging.service';
import { templatesService } from '@/features/messaging/services/templates.service';
import { vehicleAlertsService } from '@/features/messaging/services/vehicle-alerts.service';
import { notificationsService } from '@/features/notifications/services/notifications.service';
import { pushDevicesService } from '@/features/notifications/services/push-devices.service';
import { purchasesService } from '@/features/purchases/services/purchases.service';
import { qrLoginService } from '@/features/qr-login/qr-login.service';
import { quotesService } from '@/features/quotes/services/quotes.service';
import { reportsService } from '@/features/reports/services/reports.service';
import { reviewsService } from '@/features/reviews/services/reviews.service';
import { salesService } from '@/features/sales/services/sales.service';
import { staffService } from '@/features/staff/services/staff.service';
import { suppliersService } from '@/features/suppliers/services/suppliers.service';
import { todosService } from '@/features/todos/services/todos.service';

(globalThis as { __contractRoutes__?: () => unknown }).__contractRoutes__ = listRoutes;
const tag = (t: string) => (globalThis as { __contractTag__?: (t: string) => void }).__contractTag__?.(t);

/** React Native's FormData keeps parts in `_parts` (the mock multipart path reads them); node's would stringify files. */
class RNFormData {
  _parts: [string, unknown][] = [];
  append(k: string, v: unknown) {
    this._parts.push([k, v]);
  }
}
(globalThis as { FormData: unknown }).FormData = RNFormData;

let failures = 0;
const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Runs a call that must succeed. */
async function ok<T>(name: string, fn: () => Promise<T>): Promise<T> {
  tag(name);
  try {
    return await fn();
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}: ${isApiError(e) ? `${e.status} ${e.code} ${e.message}` : String(e)}`);
    return undefined as T;
  }
}

/** Runs a call that must fail with `code`. */
async function err(name: string, code: string, fn: () => Promise<unknown>) {
  tag(`neg:${name}`);
  try {
    await fn();
    failures++;
    console.log(`  ✗ ${name}: expected ${code}, got success`);
  } catch (e) {
    if (!isApiError(e) || e.code !== code) {
      failures++;
      console.log(`  ✗ ${name}: expected ${code}, got ${isApiError(e) ? e.code : String(e)}`);
    }
  }
}

async function login(email: string) {
  const t = await authService.login({ email, password: 'demo1234' });
  await session.setTokens(t, null);
  const me = await authService.getMe();
  const slug = me.organizations![0].slug;
  const t2 = await authService.switchOrganizationContext(slug);
  await session.setTokens(t2, slug);
  return me;
}

const signature =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const file = (name: string, type: string) => ({ uri: `file:///tmp/${name}`, name, type });

async function auth() {
  console.log('auth');
  await err('login wrong password', 'INVALID_CREDENTIALS', () => authService.login({ email: 'demo@otopoly.com', password: 'nope' }));
  await err('login empty', 'VALIDATION_ERROR', () => authService.login({ email: '', password: '' }));
  await err('me anonymous', 'UNAUTHENTICATED', () => request('GET', '/v1/auth/me', { anonymous: true, silent: true }));
  const me = await ok('login owner', () => login('demo@otopoly.com'));
  await ok('refresh', async () => {
    const t = await authService.refresh(session.get()!.refreshToken);
    await session.setTokens(t, session.get()!.organizationSlug);
  });
  await ok('profile', () => authService.updateProfile({ name: me.user.name, surname: me.user.surname, locale: 'tr' }));
  await err('change password wrong', 'INVALID_CREDENTIALS', () => authService.changePassword({ current_password: 'wrong-one', new_password: 'Contract-Pass-2026!' }));
  await ok('forgot password', () => authService.forgotPassword('demo@otopoly.com'));
  await ok('org by slug', () => authService.organizationBySlug(me.organizations![0].slug));
  const sessions = await ok('sessions', () => authService.listSessions());
  const other = sessions?.items.find((s) => !s.current);
  if (other) await ok('revoke session', () => authService.revokeSession(other.uuid));
  await ok('revoke others', () => authService.revokeOtherSessions());
  await ok('email verify request', () => authService.requestEmailVerify());
  await ok('totp status', () => authService.getTOTPStatus());

  // Passwordless e-mail code (demo code 246810), native OAuth, link flow.
  await ok('email code request', () => passwordlessService.requestEmailCode('demo@otopoly.com'));
  await err('email code wrong', 'INVALID_EMAIL_CODE', () => passwordlessService.verifyEmailCode('demo@otopoly.com', '000000'));
  await ok('email code verify', () => passwordlessService.verifyEmailCode('demo@otopoly.com', '246810'));
  await err('email code totp required', 'MFA_REQUIRED', async () => {
    await passwordlessService.requestEmailCode('ali@parlakoto.com');
    await passwordlessService.verifyEmailCode('ali@parlakoto.com', '246810');
  });
  await ok('email code with totp', () => passwordlessService.verifyEmailCode('ali@parlakoto.com', '246810', '123456'));
  for (const identity of DEMO_IDENTITIES) {
    const nonce = Math.random().toString(36).slice(2);
    tag(`native oauth ${identity.sub}`);
    try {
      await passwordlessService.nativeOAuth(identity.provider, { id_token: demoIdToken(identity, nonce), nonce });
    } catch (e) {
      if (!isApiError(e)) throw e;
      const ticket = (e.extra?.link_ticket ?? e.details.find((d) => d.field === 'link_ticket')?.message) as string | undefined;
      if (e.code === 'OAUTH_LINK_CHOICE_REQUIRED' && ticket) {
        await ok('link request code', () => passwordlessService.requestLinkCode(ticket, 'demo@otopoly.com'));
        await err('link verify wrong', 'INVALID_EMAIL_CODE', () => passwordlessService.verifyLink(ticket, 'demo@otopoly.com', '000000'));
        await ok('link create', () => passwordlessService.createFromLink(ticket).catch((e) => (isApiError(e) && e.code === 'FORBIDDEN' ? null : Promise.reject(e))));
      }
    }
  }
  await err('native oauth bad token', 'INVALID_ID_TOKEN', () => passwordlessService.nativeOAuth('apple', { id_token: 'garbage', nonce: 'x' }));
  await err('link verify bad ticket', 'INVALID_LINK_TICKET', () => passwordlessService.verifyLink('bad', 'demo@otopoly.com', '246810'));

  await ok('login owner again', () => login('demo@otopoly.com'));
  const ids = await ok('identities', () => identitiesService.list());
  const google = DEMO_IDENTITIES.find((i) => i.provider === 'google')!;
  const nonce = 'n-' + Date.now();
  await ok('link google', () => identitiesService.linkNative('google', { id_token: demoIdToken(google, nonce), nonce }).catch((e) => (isApiError(e) && e.code === 'CONFLICT' ? null : Promise.reject(e))));
  if (ids?.items?.length) await ok('unlink', () => identitiesService.unlink('google').catch((e) => (isApiError(e) && e.code === 'LAST_SIGN_IN_METHOD' ? null : Promise.reject(e))));
}

async function deactivation() {
  console.log('account deactivation');
  await ok('login staff3', () => login('mehmet@parlakoto.com').catch(() => login('personel@otopoly.com')));
  await ok('deactivate request', () => passwordlessService.requestDeactivationCode());
  await err('deactivate wrong code', 'INVALID_EMAIL_CODE', () => passwordlessService.deactivate('000000'));
}

async function dashboard() {
  console.log('dashboard');
  await ok('reports meta', () => reportsService.meta());
  await ok('reports overview', () => reportsService.overview({ date_from: today, date_to: today, granularity: 'day' }));
  await ok('reports overview default', () => reportsService.overview());
  await ok('jobs summary', () => jobsService.summary());
  await ok('jobs summary date', () => jobsService.summary(today));
  await ok('sales summary', () => salesService.summary());
  await ok('finance summary', () => financeService.summary({ date_from: today, date_to: today }));
}

async function jobsArea() {
  console.log('jobs');
  await ok('jobs meta', () => jobsService.meta());
  await ok('jobs list board', () => jobsService.list({ limit: 100, offset: 0, status: 'in_progress', date_from: today, include_open: 'true' }));
  await ok('jobs list q', () => jobsService.list({ limit: 20, offset: 0, q: '34', sort: '-created_at' }));
  const customers = await ok('customers for job', () => customersService.list({ limit: 5, offset: 0 }));
  const cust = await ok('customer detail', () => customersService.get(customers.items.find((c) => c.vehicle_count > 0)!.uuid));
  const services = await ok('services for job', () => catalogService.listServices({ limit: 3, offset: 0, is_active: 'true' }));
  const products = await ok('products for job', () => catalogService.listProducts({ limit: 3, offset: 0, track_stock: 'true' }));
  const staff = await ok('staff options', () => staffService.options());
  const job = await ok('job create', () =>
    jobsService.create({
      customer_uuid: cust.uuid,
      vehicle_uuid: cust.vehicles[0].uuid,
      assignee_uuid: staff.items[0]?.uuid,
      notes: 'contract',
      lines: services.items.map((s) => ({ service_uuid: s.uuid, unit_price: undefined })),
    }),
  );
  await err('job create empty', 'VALIDATION_ERROR', () => jobsService.create({ customer_uuid: '', vehicle_uuid: '', lines: [] }));
  await err('job get unknown', 'NOT_FOUND', () => jobsService.get('00000000-0000-4000-8000-000000000000'));
  await ok('job get', () => jobsService.get(job.uuid));
  await ok('job patch', () => jobsService.patch(job.uuid, { notes: 'patched', assignee_uuid: null }));
  const withC = await ok('consumption add', () => jobsService.addConsumption(job.uuid, { product_uuid: products.items[0].uuid, qty: '1' }));
  const c = withC?.consumptions.find((x) => x.product_uuid === products.items[0].uuid);
  if (c) {
    await ok('consumption update', () => jobsService.updateConsumption(job.uuid, c.uuid, '2'));
    await ok('consumption delete', () => jobsService.deleteConsumption(job.uuid, c.uuid));
  }
  await err('void unpaid', 'CONFLICT', () => jobsService.void(job.uuid));
  await ok('job ready', () => jobsService.ready(job.uuid));
  await err('job ready twice', 'CONFLICT', () => jobsService.ready(job.uuid));
  await ok('job deliver', () => jobsService.deliver(job.uuid));
  const accounts = await ok('accounts for close', () => financeService.listAccounts({ limit: 50, offset: 0 }));
  const cash = accounts.items.find((a) => a.type === 'cash')!;
  await ok('job close', () => jobsService.close(job.uuid, { method: 'cash', finance_account_uuid: cash.uuid }));
  await ok('job void', () => jobsService.void(job.uuid));
  const job2 = await ok('job create 2', () => jobsService.create({ customer_uuid: cust.uuid, vehicle_uuid: cust.vehicles[0].uuid, lines: [{ service_uuid: services.items[0].uuid }] }));
  await ok('job done', () => jobsService.done(job2.uuid));
  const job3 = await ok('job create 3', () => jobsService.create({ customer_uuid: cust.uuid, vehicle_uuid: cust.vehicles[0].uuid, lines: [{ service_uuid: services.items[0].uuid }] }));
  await ok('job cancel', () => jobsService.cancel(job3.uuid));
  await ok('jobs by customer', () => jobsService.listByCustomer(cust.uuid, { limit: 20, offset: 0 }));
}

async function customersArea() {
  console.log('customers');
  await ok('customers meta', () => customersService.meta());
  await ok('customers list', () => customersService.list({ limit: 20, offset: 0, q: 'a', kind: 'individual', is_active: 'true' }));
  const catalog = await ok('vehicle catalog', () => customersService.searchCatalog('Toyota'));
  const opt = catalog.items[0];
  const created = await ok('customer create', () =>
    customersService.create({ name: 'Contract Test', phone: '+905551112233', email: 'contract@example.com', kind: 'individual', notes: '', vehicle: { plate: '34 CT 001', model_uuid: opt.model_uuid, year: opt.year } }),
  );
  await ok('customer quick create', () => customersService.create({ name: 'Quick Contract', phone: '+905551112234' }));
  await err('customer create empty', 'VALIDATION_ERROR', () => customersService.create({ name: '' }));
  await ok('customer update', () => customersService.update(created.uuid, { name: 'Contract Test 2', is_active: true }));
  const v = await ok('vehicle add', () => customersService.addVehicle(created.uuid, { plate: '34 CT 002', model_uuid: opt.model_uuid, year: opt.year }));
  await ok('vehicle remove', () => customersService.removeVehicle(v.uuid));
  await ok('customer remove', () => customersService.remove(created.uuid));
  await err('customer get unknown', 'NOT_FOUND', () => customersService.get('00000000-0000-4000-8000-000000000000'));
  // Customer 360 activity timeline: first page and "load more".
  const busy = await ok('customers with vehicles', () => customersService.list({ limit: 5, offset: 0 }));
  const withVehicles = busy.items.find((c) => c.vehicle_count > 0) ?? busy.items[0];
  await ok('customer activity', () => customersService.activity(withVehicles.uuid, { limit: 5, offset: 0 }));
  await ok('customer activity more', () => customersService.activity(withVehicles.uuid, { limit: 5, offset: 5 }));
  await err('customer activity unknown', 'NOT_FOUND', () => customersService.activity('00000000-0000-4000-8000-000000000000'));
}

async function financeArea() {
  console.log('finance');
  await ok('accounts meta', () => financeService.accountsMeta());
  await ok('categories meta', () => financeService.categoriesMeta());
  await ok('transactions meta', () => financeService.transactionsMeta());
  const accounts = await ok('accounts', () => financeService.listAccounts({ limit: 50, offset: 0, is_active: 'true' }));
  const cash = accounts.items.find((a) => a.type === 'cash')!;
  const bank = accounts.items.find((a) => a.uuid !== cash.uuid)!;
  const acc = await ok('account create', () => financeService.createAccount({ name: 'Contract Kasa', bank_name: '', iban: '', is_default: false, type: 'cash', currency: 'TRY', opening_balance: '0' }));
  await ok('account patch', () => financeService.patchAccount(acc.uuid, { name: 'Contract Kasa 2', bank_name: '', iban: '', is_default: false, is_active: true }));
  await ok('account get', () => financeService.getAccount(acc.uuid));
  await ok('account detail', () => financeService.getAccountDetail(cash.uuid, { limit: 20 }));
  await ok('account delete', () => financeService.deleteAccount(acc.uuid));
  const cats = await ok('categories', () => financeService.listCategories({ kind: 'expense', is_active: 'true' }));
  const cat = await ok('category create', () => financeService.createCategory({ name: 'Contract Gider', kind: 'expense' }));
  await ok('category get', () => financeService.getCategory(cat.uuid));
  await ok('category patch', () => financeService.patchCategory(cat.uuid, { name: 'Contract Gider 2', sort_order: 0, is_active: true }));
  await ok('category detail', () => financeService.getCategoryDetail(cats.items[0].uuid, { limit: 20 }));
  await ok('category delete', () => financeService.deleteCategory(cat.uuid));
  await ok('transactions', () => financeService.listTransactions({ limit: 20, offset: 0, type: 'expense', status: 'posted', date_from: today, date_to: today }));
  const tx = await ok('transaction create', () =>
    financeService.createTransaction({ type: 'expense', account_uuid: cash.uuid, amount: '10.00', transaction_date: today, description: 'contract', payment_method: 'cash', category_uuid: cats.items[0].uuid }),
  );
  await err('transaction create empty', 'VALIDATION_ERROR', () => financeService.createTransaction({ type: 'expense' }));
  await ok('transaction get', () => financeService.getTransaction(tx.uuid));
  await ok('transaction void', () => financeService.voidTransaction(tx.uuid));
  await ok('transfer', () => financeService.createTransfer({ from_account_uuid: cash.uuid, to_account_uuid: bank.uuid, amount: '1.00', transaction_date: today, description: 'contract' }));

  console.log('cari');
  await ok('cari meta', () => cariService.meta());
  await ok('cari summary', () => cariService.summary());
  const list = await ok('cari list', () => cariService.list({ limit: 20, offset: 0, has_balance: 'true' }));
  const acct = list.items[0];
  await ok('cari get', () => cariService.get(acct.uuid));
  await ok('cari entries', () => cariService.listEntries(acct.uuid, { limit: 20, offset: 0 }));
  const charge = await ok('cari charge', () => cariService.charge(acct.uuid, { amount: '5.00', entry_date: today, description: 'contract' }));
  await ok('cari payment', () => cariService.payment(acct.uuid, { amount: '5.00', entry_date: today, finance_account_uuid: cash.uuid, payment_method: 'cash' }));
  await ok('cari adjustment', () => cariService.adjustment(acct.uuid, { amount: '1.00', direction: 'decrease', entry_date: today }));
  await ok('cari void entry', () => cariService.voidEntry(charge.uuid));
}

async function commerceArea() {
  console.log('commerce');
  await ok('sales meta', () => salesService.meta());
  await ok('sales list', () => salesService.list({ limit: 20, offset: 0, date_from: today, date_to: today }));
  const products = await ok('products', () => catalogService.listProducts({ limit: 50, offset: 0, stock_status: 'in_stock' }));
  const sellable = products.items.find((p) => Number(p.sale_price) > 0) ?? products.items[0];
  const accounts = await ok('accounts', () => financeService.listAccounts({ limit: 50, offset: 0 }));
  const cash = accounts.items.find((a) => a.type === 'cash')!;
  const sale = await ok('sale create', () => salesService.create({ customer_uuid: null, method: 'cash', finance_account_uuid: cash.uuid, lines: [{ product_uuid: sellable.uuid, qty: '1', unit_price: Number(sellable.sale_price) > 0 ? undefined : '10.00' }] }));
  const customers = await ok('customers', () => customersService.list({ limit: 1, offset: 0 }));
  await ok('sale create cari', () => salesService.create({ customer_uuid: customers.items[0].uuid, method: 'cari', lines: [{ product_uuid: products.items[0].uuid, unit_price: '99.00', qty: '1' }] }));
  // Customer 360: recent sales of the customer (useCustomerSales).
  await ok('sales by customer', () => salesService.list({ customer_uuid: customers.items[0].uuid, limit: 10, offset: 0 }));
  await err('sales by malformed customer', 'VALIDATION_ERROR', () => salesService.list({ customer_uuid: 'nope', limit: 10, offset: 0 }));
  await err('sale create empty', 'VALIDATION_ERROR', () => salesService.create({ method: 'cash', lines: [] }));
  await ok('sale get', () => salesService.get(sale.uuid));
  await ok('sale void', () => salesService.void(sale.uuid));

  await ok('suppliers meta', () => suppliersService.meta());
  await ok('suppliers list', () => suppliersService.list({ limit: 20, offset: 0, is_active: 'true' }));
  const sup = await ok('supplier create', () => suppliersService.create({ name: 'Contract Tedarik', phone: '+905550000000', email: 'tedarik@example.com', tax_id: '1234567890', notes: '', is_active: true }));
  await ok('supplier get', () => suppliersService.get(sup.uuid));
  await ok('supplier update', () => suppliersService.update(sup.uuid, { name: 'Contract Tedarik 2' }));
  await ok('purchases meta', () => purchasesService.meta());
  await ok('purchases list', () => purchasesService.list({ limit: 20, offset: 0 }));
  // Supplier 360: recent purchases from the supplier (useSupplierPurchases).
  await ok('purchases by supplier', () => purchasesService.list({ supplier_uuid: sup.uuid, status: 'posted', limit: 100, offset: 0 }));
  const purchase = await ok('purchase create', () =>
    purchasesService.create({ supplier_uuid: sup.uuid, method: 'cash', finance_account_uuid: cash.uuid, lines: [{ product_uuid: products.items[0].uuid, unit_cost: '10.00', qty: '2' }] }),
  );
  await ok('purchase get', () => purchasesService.get(purchase.uuid));
  await ok('purchase void', () => purchasesService.void(purchase.uuid));
  await ok('supplier remove', () => suppliersService.remove(sup.uuid));
}

async function crmArea() {
  console.log('crm');
  const customers = await ok('customers', () => customersService.list({ limit: 5, offset: 0 }));
  const cust = await ok('customer', () => customersService.get(customers.items.find((c) => c.vehicle_count > 0)!.uuid));
  const services = await ok('services', () => catalogService.listServices({ limit: 2, offset: 0 }));
  const products = await ok('products', () => catalogService.listProducts({ limit: 2, offset: 0 }));
  await ok('quotes list', () => quotesService.list({ status: 'sent' }));
  // Customer 360: the customer's quotes.
  await ok('quotes by customer', () => quotesService.list({ customer_uuid: cust.uuid, limit: 20 }));
  await ok('quotes summary', () => quotesService.summary());
  const quote = await ok('quote create', () =>
    quotesService.create({
      customer_uuid: cust.uuid,
      vehicle: { vehicle_uuid: cust.vehicles[0].uuid },
      currency: 'TRY',
      prices_include_vat: true,
      discount_type: 'percent',
      discount_value: '10',
      valid_until: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      notes: '',
      terms: '',
      lines: [
        { line_type: 'service', service_uuid: services.items[0].uuid, quantity: '1' },
        { line_type: 'product', product_uuid: products.items[0].uuid, quantity: '2', unit_price: '50.00' },
        { line_type: 'custom', description: 'Ek işçilik', quantity: '1', unit: 'adet', unit_price: '100.00', vat_rate: '20' },
      ],
    }),
  );
  await err('quote create empty', 'VALIDATION_ERROR', () => quotesService.create({ customer_uuid: '', currency: 'TRY', prices_include_vat: true, lines: [] }));
  await ok('quote get', () => quotesService.get(quote.uuid));
  await ok('quote update', () =>
    quotesService.update(quote.uuid, { customer_uuid: cust.uuid, vehicle: { vehicle_uuid: cust.vehicles[0].uuid }, valid_until: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), currency: 'TRY', prices_include_vat: false, lines: [{ line_type: 'service', service_uuid: services.items[0].uuid, quantity: '1' }] }),
  );
  await ok('quote send preview', () => quotesService.sendPreview(quote.uuid));
  const sent = await ok('quote send', () => quotesService.send(quote.uuid, { channel: 'whatsapp', reminders: [{ kind: 'before_1d' }] }));
  const delivery = (sent as { delivery?: { uuid?: string } } | undefined)?.delivery;
  if (delivery?.uuid) await ok('quote retry delivery', () => quotesService.retryDelivery(quote.uuid, delivery.uuid!).catch((e) => (isApiError(e) && e.code === 'CONFLICT' ? null : Promise.reject(e))));
  await ok('quote reminders', () => quotesService.setReminders(quote.uuid, [{ kind: 'last_day' }]));
  const dup = await ok('quote duplicate', () => quotesService.duplicate(quote.uuid));
  await ok('quote status', () => quotesService.setStatus(dup.uuid, 'cancelled', 'contract'));
  await ok('quote convert preview', () => quotesService.convertPreview(quote.uuid));
  await ok('quote convert', () => quotesService.convert(quote.uuid, { notes: 'contract' }));
  await err('quote convert twice', 'CONFLICT', () => quotesService.convert(quote.uuid, {}));

  await ok('leads list', () => leadsService.list({ status: 'new' }));
  // Customer 360: the customer's leads.
  await ok('leads by customer', () => leadsService.list({ customer_uuid: cust.uuid, limit: 20 }));
  await ok('leads summary', () => leadsService.summary());
  await ok('leads assignees', () => leadsService.assignees());
  const lead = await ok('lead create', () =>
    leadsService.create({ customer_uuid: cust.uuid, vehicle_uuid: cust.vehicles[0].uuid, interest: 'Seramik kaplama', source: 'whatsapp', temperature: 'warm', notes: '', follow_up_date: today }),
  );
  await err('lead create empty', 'VALIDATION_ERROR', () => leadsService.create({ customer_uuid: '' }));
  await ok('lead get', () => leadsService.get(lead.uuid));
  await ok('lead patch', () => leadsService.patch(lead.uuid, { status: 'contacted', temperature: 'hot' }));
  await ok('lead note', () => leadsService.addNote(lead.uuid, 'Aradım'));
  await ok('lead todo', () => leadsService.createTodo(lead.uuid, { title: 'Geri ara', due_date: today, due_time: '10:00' }));
  await ok('lead lost', () => leadsService.patch(lead.uuid, { status: 'lost', lost_reason: 'price' }));
  await ok('lead remove', () => leadsService.remove(lead.uuid));

  await ok('todos list', () => todosService.list({ status: 'open', scope: 'today' }));
  await ok('todos summary', () => todosService.summary());
  await ok('todos assignees', () => todosService.assignees());
  const todo = await ok('todo create', () => todosService.create({ title: 'Contract todo', notes: '', due_date: today, due_time: '09:30', customer_uuid: cust.uuid, reminder_offsets: [60] }));
  await err('todo create empty', 'VALIDATION_ERROR', () => todosService.create({ title: '' }));
  await ok('todo get', () => todosService.get(todo.uuid));
  await ok('todo patch', () => todosService.patch(todo.uuid, { title: 'Contract todo 2' }));
  await ok('todo complete', () => todosService.complete(todo.uuid));
  await ok('todo reopen', () => todosService.reopen(todo.uuid));
  await ok('todo remove', () => todosService.remove(todo.uuid));
}

async function catalogArea() {
  console.log('catalog');
  await ok('catalog summary', () => catalogService.summary());
  await ok('products meta', () => catalogService.productsMeta());
  await ok('services meta', () => catalogService.servicesMeta());
  await ok('categories meta', () => catalogService.categoriesMeta());
  const cats = await ok('categories', () => catalogService.listCategories({ kind: 'product', is_active: 'true' }));
  const cat = await ok('category create', () => catalogService.createCategory({ name: 'Contract Kategori', kind: 'product' }));
  await ok('category get', () => catalogService.getCategory(cat.uuid));
  await ok('category update', () => catalogService.updateCategory(cat.uuid, { name: 'Contract Kategori 2', is_active: true }));
  await ok('products', () => catalogService.listProducts({ limit: 20, offset: 0, category_uuid: cats.items[0]?.uuid, stock_status: 'low_stock', is_active: 'true' }));
  const product = await ok('product create', () =>
    catalogService.createProduct({
      name: 'Contract Ürün',
      category_uuid: cat.uuid,
      sku: 'CT-1',
      barcode: '',
      unit: 'adet',
      cost_price: '10',
      sale_price: '20',
      vat_rate: '20',
      currency: 'TRY',
      stock_quantity: '5',
      min_stock_alert: '1',
      track_stock: true,
      is_active: true,
      description: '',
    }),
  );
  await err('product create empty', 'VALIDATION_ERROR', () => catalogService.createProduct({ name: '' }));
  await ok('product get', () => catalogService.getProduct(product.uuid));
  await ok('product update', () => catalogService.updateProduct(product.uuid, { sale_price: '25' }));
  await ok('stock adjust', () => catalogService.adjustProductStock(product.uuid, { delta: '2', reason: 'count', description: 'contract' }));
  const svc = await ok('service create', () => catalogService.createService({ name: 'Contract Hizmet', category_uuid: null, code: 'CT', duration_minutes: 30, price: '100', vat_rate: '20', currency: 'TRY', is_active: true, description: '', color: 'blue' }));
  await ok('services', () => catalogService.listServices({ limit: 20, offset: 0, q: 'Contract' }));
  await ok('service get', () => catalogService.getService(svc.uuid));
  await ok('service update', () => catalogService.updateService(svc.uuid, { price: '120' }));
  await ok('service products set', () => catalogService.setServiceProducts(svc.uuid, [{ product_uuid: product.uuid, qty: '1' }]));
  await ok('service products', () => catalogService.listServiceProducts(svc.uuid));
  await ok('service delete', () => catalogService.deleteService(svc.uuid));
  await ok('product delete', () => catalogService.deleteProduct(product.uuid));
  await ok('category delete', () => catalogService.deleteCategory(cat.uuid));
}

async function documentsArea() {
  console.log('documents');
  await ok('templates meta', () => contractsService.templateMeta());
  const templates = await ok('templates', () => contractsService.listTemplates({ limit: 50, offset: 0, is_active: 'true' }));
  const presets = await ok('presets', () => contractsService.listPresets({ limit: 50, offset: 0 }));
  const clone = await ok('template clone', () => contractsService.cloneTemplate({ preset_uuid: presets.items[0].uuid, title: 'Contract klon' }));
  await ok('template get', () => contractsService.getTemplate(clone.uuid));
  await ok('template update', () => contractsService.updateTemplate(clone.uuid, { title: 'Contract klon 2', is_active: true }));
  const created = await ok('template create', () =>
    contractsService.createTemplate({ title: 'Contract şablon', description: '', category: 'service', content_html: '<p>{{customer.name}}</p>', variables: ['customer.name'], signature_required: false, otp_required: false, is_active: true }),
  );
  await ok('template remove', () => contractsService.removeTemplate(created.uuid));
  const jobs = await ok('jobs', () => jobsService.list({ limit: 1, offset: 0 }));
  const signed = templates.items.find((t) => t.signature_required) ?? templates.items[0];
  await ok('instances', () => contractsService.listInstances({ limit: 20, offset: 0, subject_type: 'service_job', subject_uuid: jobs.items[0].uuid }));
  // Customer 360 contracts section.
  await ok('instances by customer', () => contractsService.listInstances({ limit: 20, offset: 0, customer_uuid: jobs.items[0].customer_uuid }));
  const inst = await ok('instance create', () => contractsService.createInstance({ template_uuid: signed.uuid, subject_type: 'service_job', subject_uuid: jobs.items[0].uuid, title: 'Contract sözleşme' }));
  await ok('instance get', () => contractsService.getInstance(inst.uuid));
  const signer = inst?.signers?.[0];
  if (signer) {
    if (signed.otp_required) {
      await ok('signer otp', () => contractsService.sendSignerOtp(inst.uuid, signer.uuid, {}));
      await err('signer otp wrong', 'INVALID_OTP_CODE', () => contractsService.verifySignerOtp(inst.uuid, signer.uuid, '000000'));
    }
    await ok('sign', () => contractsService.sign(inst.uuid, signer.uuid, { display_name: 'Contract Müşteri', signature_png_base64: signature }).catch((e) => (isApiError(e) && e.code === 'OTP_REQUIRED' ? null : Promise.reject(e))));
  }
  const deferred = await ok('instance deferred', () => contractsService.createInstance({ template_uuid: templates.items.find((t) => !t.signature_required)?.uuid ?? signed.uuid, subject_type: 'service_job', subject_uuid: jobs.items[0].uuid, defer_execute: true }));
  const media = await ok('media upload', () => contractsService.uploadMedia(deferred.uuid, file('photo.jpg', 'image/jpeg'), 'Ön'));
  if (media?.uuid) await ok('media delete', () => contractsService.deleteMedia(deferred.uuid, media.uuid));
  await ok('instance finalize', () => contractsService.finalizeInstance(deferred.uuid).catch((e) => (isApiError(e) && e.code === 'CONFLICT' ? null : Promise.reject(e))));
  await ok('instance void', () => contractsService.voidInstance(inst.uuid).catch((e) => (isApiError(e) && e.code === 'CONFLICT' ? null : Promise.reject(e))));

  console.log('exports / imports');
  // Exactly what the "new export" sheet offers.
  for (const { resource } of TENANT_EXPORTS) {
    const path = exportPath(resource);
    if (!path) continue;
    await ok(`export ${resource}`, () => exportsService.request(path, { format: 'xlsx', query: { q: '' }, locale: 'tr' }).catch((e) => (isApiError(e) && e.code === 'FORBIDDEN' ? null : Promise.reject(e))));
  }
  const exports = await ok('exports list', () => exportsService.list({ limit: 20, offset: 0 }));
  if (exports?.items?.[0]) await ok('export get', () => exportsService.get(exports.items[0].uuid));
  for (const { resource } of TENANT_IMPORTS) {
    const p = IMPORT_PATHS[resource];
    if (!p?.upload) continue;
    const job = await ok(`import ${resource}`, () => importsService.upload(p.upload, file('import.csv', 'text/csv'), 'csv', 'tr'));
    if (!job?.uuid) continue;
    await ok('import get', () => importsService.get(job.uuid));
    await ok('import mapping', () => importsService.updateMapping(job.uuid, { mapping: job.mapping ?? {}, defaults: {} }));
    await ok('import preview', () => importsService.preview(job.uuid));
    await ok('import confirm', () => importsService.confirm(job.uuid));
    await err('import rollback before apply', 'VALIDATION_ERROR', () => importsService.rollback(job.uuid));
  }
  await ok('imports list', () => importsService.list({ limit: 20, offset: 0 }));
}

async function settingsArea() {
  console.log('settings');
  await ok('settings get', () => exportSettingsService.get());
  await ok('settings patch', () => exportSettingsService.patch({ paper_size: 'A4' } as never));
  await ok('settings sector', () => exportSettingsService.patch({ sector: 'detailing' }));
  await ok('settings sector clear', () => exportSettingsService.patch({ sector: '' }));
  await err('settings sector invalid', 'VALIDATION_ERROR', () => exportSettingsService.patch({ sector: 'bakery' } as never));
  await ok('logo upload', () => mockFormRequest('PUT', '/v1/tenant/settings/logo', (() => { const f = new FormData(); f.append('logo', file('logo.png', 'image/png') as unknown as Blob); return f; })()));
  await ok('logo delete', () => exportSettingsService.deleteLogo());
  await ok('staff meta', () => staffService.meta());
  await ok('staff list', () => staffService.list());
  const member = await ok('staff create', () => staffService.create({ name: 'Contract', surname: 'Personel', email: `contract${Date.now()}@example.com`, password: 'Demo12345!' }));
  await ok('staff patch', () => staffService.patch(member.uuid, { status: 'inactive' }));
  await ok('staff reset password', () => staffService.resetPassword(member.uuid, { password: 'Demo12345!' }));
  await err('staff create empty', 'VALIDATION_ERROR', () => staffService.create({ name: '', surname: '', email: '', password: '' }));

  await ok('wa session', () => messagingService.getSession());
  await ok('wa connect', () => messagingService.connectWhatsApp());
  const rules = await ok('rules', () => messagingService.listRules());
  const rule = (rules as unknown as { event_type: string; channels?: { channel: string; enabled: boolean }[]; channel?: string; enabled?: boolean }[])[0];
  if (rule) await ok('rule toggle', () => messagingService.toggleRule(rule.event_type, rule.channels?.[0]?.channel ?? rule.channel ?? 'whatsapp', true));
  const types = await ok('template types', () => templatesService.catalog());
  const t = types?.find((x) => x.channels.includes('whatsapp'));
  if (t) {
    await ok('template save', () => templatesService.save({ eventType: t.type, channel: 'whatsapp', locale: 'tr' }, { body: 'Merhaba {{customer.name}}', is_active: true }));
    await ok('template reset', () => templatesService.reset({ eventType: t.type, channel: 'whatsapp', locale: 'tr' }));
  }
  await ok('simulate', () => messagingService.simulate({ mode: 'event', event_type: t?.type ?? 'job.ready', channel: 'whatsapp', phone: '+905551112233' }));
  const ds = await ok('daily summary', () => dailySummaryService.get());
  await ok('daily summary update', () => dailySummaryService.update({ enabled: true, send_time: '20:00', recipient_user_uuids: (ds as unknown as { recipient_user_uuids?: string[] })?.recipient_user_uuids ?? [] }));
  await ok('daily summary preview', () => dailySummaryService.preview());
  await ok('daily summary test', () => dailySummaryService.sendTest().catch((e) => (isApiError(e) && (e.code === 'WHATSAPP_NOT_CONNECTED' || e.code === 'NO_RECIPIENT_PHONE') ? null : Promise.reject(e))));
  const va = await ok('vehicle alerts', () => vehicleAlertsService.get());
  await ok('vehicle alerts update', () => vehicleAlertsService.update({ ...(va as unknown as Record<string, never>), enabled: true } as never));
  await ok('vehicle alerts test', () => vehicleAlertsService.sendTest().catch((e) => (isApiError(e) && (e.code === 'WHATSAPP_NOT_CONNECTED' || e.code === 'VALIDATION_ERROR') ? null : Promise.reject(e))));
  await ok('wa disconnect', () => messagingService.disconnectWhatsApp());
}

async function aiArea() {
  console.log('ai');
  await ok('ai status', () => aiService.status());
  await ok('ai conversations', () => aiService.listConversations({ q: '' }));
  const conv = await ok('ai create', () => aiService.createConversation('Contract'));
  await ok('ai rename', () => aiService.renameConversation(conv.uuid, 'Contract 2'));
  // SSE: every streamed event is recorded and validated against the event shapes the spec documents.
  for (const q of ['Bugün kaç iş var?', 'Bu ayın gelir grafiği', 'Stoğu azalan ürünler hangileri?']) await ok(`ai send ${q}`, () => aiService.sendMessage(conv.uuid, q, 'tr'));
  await ok('ai send action', () => aiService.sendMessage(conv.uuid, 'Yarın lastik siparişini hatırlat', 'tr'));
  const detail = await ok('ai get', () => aiService.getConversation(conv.uuid));
  const blocks = (detail?.messages ?? []).flatMap((m) => m.blocks);
  const card = blocks.find((b) => b.type === 'confirm' && b.status === 'pending');
  if (card?.id) await ok('ai confirm', () => aiService.confirmAction(card.id!, { title: 'Contract lastik' }, 'tr'));
  await err('ai send empty', 'VALIDATION_ERROR', () => aiService.sendMessage(conv.uuid, ' ', 'tr'));
  if (card?.id) await err('ai confirm twice', 'AI_ACTION_RESOLVED', () => aiService.confirmAction(card.id!, undefined, 'tr'));
  const fresh = await ok('ai create untitled', () => aiService.createConversation());
  if (fresh) await ok('ai send titled', () => aiService.sendMessage(fresh.uuid, 'Kasalarda ne kadar para var?', 'en'));
  await ok('ai delete', () => aiService.deleteConversation(conv.uuid));
}

async function notificationsArea() {
  console.log('notifications');
  await ok('push register', () => pushDevicesService.register({ token: 'ExponentPushToken[contract-test-0001]', platform: 'ios', locale: 'tr-TR', app_version: '1.0.0 (1)', device_name: 'iPhone' }));
  await ok('notif test', () => notificationsService.sendTest());
  const page = await ok('notif list', () => notificationsService.list({ limit: 20, offset: 0, unread: true }));
  await ok('notif list all', () => notificationsService.list({ limit: 20, offset: 0, status: 'unread', sort: '-created_at' }));
  await ok('unread', () => notificationsService.unreadCount());
  await ok('notif meta', () => request('GET', '/v1/notifications/meta'));
  const n = page?.items?.[0];
  if (n) {
    await ok('notif get', () => notificationsService.get(n.uuid));
    await ok('notif read', () => notificationsService.markRead(n.uuid));
    if (n.signed_action_url) await ok('notif action', () => notificationsService.redeemSignedAction(n));
  }
  await err('notif action bad sig', 'VALIDATION_ERROR', () => request('GET', `/v1/notifications/${n?.uuid ?? 'x'}/action`, { query: { exp: 1, sig: 'bad' }, silent: true }));
  await ok('read all', () => notificationsService.markAllRead());
  const prefs = await ok('prefs', () => notificationPreferencesService.get());
  await ok('prefs update', () => notificationPreferencesService.update({ ...prefs, push_enabled: true }));
  const tprefs = await ok('tenant prefs', () => tenantNotificationPreferencesService.get());
  const first = (tprefs as unknown as { types?: { type: string; prefs: never }[] })?.types?.[0];
  await ok('tenant prefs update', () => tenantNotificationPreferencesService.update({ types: first ? [{ type: first.type, prefs: first.prefs }] : [] }));
  await ok('push unregister', () => pushDevicesService.unregister('ExponentPushToken[contract-test-0001]'));
}

async function billingArea() {
  console.log('billing');
  await ok('billing overview', () => billingService.overview());
  setPlanScenario('at_limit');
  const customers = await ok('customers', () => customersService.list({ limit: 5, offset: 0 }));
  const cust = await ok('customer', () => customersService.get(customers.items.find((c) => c.vehicle_count > 0)!.uuid));
  const services = await ok('services', () => catalogService.listServices({ limit: 1, offset: 0 }));
  await err('limit reached', 'LIMIT_REACHED', () => jobsService.create({ customer_uuid: cust.uuid, vehicle_uuid: cust.vehicles[0].uuid, lines: [{ service_uuid: services.items[0].uuid }] }));
  setPlanScenario('normal');
}

async function loyaltyArea() {
  console.log('loyalty');
  await ok('loyalty overview', () => loyaltyService.overview(7));
  await ok('loyalty campaigns', () => loyaltyService.listCampaigns({ limit: 20, offset: 0, is_active: 'true' }));
  const packages = await ok('loyalty packages', () => loyaltyService.listPackages({ limit: 100, offset: 0, is_active: 'true' }));
  await ok('loyalty plans', () => loyaltyService.listPlans({ limit: 20, offset: 0, q: 'yıkama' }));
  const sold = await ok('loyalty sold', () => loyaltyService.listCustomerPackages({ limit: 20, offset: 0, state: 'active' }));
  if (sold.items[0]) await ok('loyalty sold detail', () => loyaltyService.getCustomerPackage(sold.items[0].uuid));
  const subs = await ok('loyalty renewals', () => loyaltyService.listSubscriptions({ limit: 20, offset: 0, due_within_days: 7 }));
  if (subs.items[0]) await ok('loyalty subscription detail', () => loyaltyService.getSubscription(subs.items[0].uuid));
  const customers = await ok('customers', () => customersService.list({ limit: 5, offset: 0 }));
  const cust = customers.items[0];
  await ok('customer loyalty', () => loyaltyService.customerLoyalty(cust.uuid));
  await err('sell without package', 'VALIDATION_ERROR', () => loyaltyService.sellPackage({ package_uuid: '', customer_uuid: cust.uuid, method: 'cari' }));
  await ok('sell package', () => loyaltyService.sellPackage({ package_uuid: packages.items[0].uuid, customer_uuid: cust.uuid, method: 'cari', notes: 'contract' }));
  const jobs = await ok('jobs', () => jobsService.list({ limit: 5, offset: 0, status: 'in_progress' }));
  if (jobs.items[0]) {
    await ok('job loyalty', () => loyaltyService.jobLoyalty(jobs.items[0].uuid));
    const job = await ok('job', () => jobsService.get(jobs.items[0].uuid));
    const line = job.lines.find((l) => !l.discount_source);
    if (line) await err('apply unknown', 'NOT_APPLICABLE', () => loyaltyService.applyToJob(job.uuid, { kind: 'reward', source_uuid: '00000000-0000-4000-8000-000000000000', line_uuid: line.uuid }));
  }
  setPlanScenario('feature_disabled');
  await err('loyalty plan off', 'FEATURE_DISABLED', () => loyaltyService.overview(7));
  setPlanScenario('normal');
}

async function qrArea() {
  console.log('qr');
  const created = await ok('qr create', () => qrLoginService.createDemo());
  await ok('qr get', () => qrLoginService.get(created.session_id));
  await ok('qr approve', () => qrLoginService.approve(created.session_id));
  await err('qr approve twice', 'QR_SESSION_RESOLVED', () => qrLoginService.approve(created.session_id));
  const c2 = await ok('qr create 2', () => qrLoginService.createDemo());
  await ok('qr reject', () => qrLoginService.reject(c2.session_id));
  await err('qr unknown', 'QR_SESSION_NOT_FOUND', () => qrLoginService.get('unknown-session'));
}

async function reviewsArea() {
  console.log('reviews');
  await ok('reviews meta', () => request('GET', '/v1/tenant/reviews/meta'));
  const list = await ok('reviews list', () => reviewsService.list());
  await ok('reviews filters', () => reviewsService.list({ follow_up: 'required', rating: 'low', channel: 'whatsapp', days: 90, q: 'a', sort: '-score' }));
  await ok('reviews summary', () => reviewsService.summary(30));
  await ok('reviews summary year', () => reviewsService.summary(365));
  const low = (await ok('reviews follow-up list', () => reviewsService.list({ follow_up: 'required' })))?.items[0];
  const first = list?.items[0];
  if (first) await ok('review detail', () => reviewsService.get(first.uuid));
  if (low) await ok('review follow-up', () => reviewsService.followUp(low.uuid, 'Arandı'));
  const waiting = (await ok('reviews sent', () => reviewsService.list({ status: 'sent' })))?.items[0];
  if (waiting) await err('follow-up unanswered', 'CONFLICT', () => reviewsService.followUp(waiting.uuid, ''));
  await err('review unknown', 'NOT_FOUND', () => reviewsService.get('00000000-0000-4000-8000-000000000000'));
  await err('reviews bad status', 'VALIDATION_ERROR', () => reviewsService.list({ status: 'bogus' as never }));
  const st = await ok('review settings', () => reviewsService.settings());
  await ok('review settings save', () => reviewsService.saveSettings({ enabled: true, channel: 'auto', delay_minutes: st?.delay_minutes ?? 120, google_review_url: 'https://g.page/r/demo/review', excluded_customer_uuids: [] }));
  await err('review settings bad url', 'VALIDATION_ERROR', () => reviewsService.saveSettings({ google_review_url: 'http://x.test' }));
  await ok('review test send', () => reviewsService.sendTest('+90 555 123 45 67'));
  await ok('reviews with tests', () => reviewsService.list({ include_tests: true }));
  setPlanScenario('feature_disabled');
  await err('reviews plan off', 'FEATURE_DISABLED', () => reviewsService.list());
  setPlanScenario('normal');
}

async function staffView() {
  console.log('staff permissions');
  await ok('login staff', () => login('personel@otopoly.com'));
  await err('staff finance write', 'FORBIDDEN', () => financeService.createTransaction({ type: 'expense', account_uuid: 'x', amount: '1', transaction_date: today }));
  await err('staff void', 'FORBIDDEN', () => jobsService.void('00000000-0000-4000-8000-000000000000'));
  await ok('staff jobs', () => jobsService.list({ limit: 5, offset: 0 }));
  await ok('staff reviews', () => reviewsService.list());
  await err('staff review settings', 'FORBIDDEN', () => reviewsService.saveSettings({ enabled: false }));
}

(async () => {
  await installMockTransport();
  await auth();
  await ok('login owner', () => login('demo@otopoly.com'));
  await dashboard();
  await jobsArea();
  await customersArea();
  await financeArea();
  await commerceArea();
  await crmArea();
  await catalogArea();
  await documentsArea();
  await settingsArea();
  await aiArea();
  await notificationsArea();
  await billingArea();
  await loyaltyArea();
  await qrArea();
  await reviewsArea();
  await staffView();
  await deactivation();
  await ok('logout', () => authService.logout(session.get()!.refreshToken));
  console.log(failures ? `drive: ${failures} FAILED` : 'drive: all calls behaved');
  process.exit(failures ? 1 : 0);
})();

export type { Tokens };
