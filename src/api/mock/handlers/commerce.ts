/** Cari (receivables), quick sales, suppliers and purchases. */
import type { CariAccountDetail, CariEntry } from '@/features/cari/services/cari.service';
import type { PurchaseDetail } from '@/features/purchases/services/purchases.service';
import type { SaleDetail, SalesSummary } from '@/features/sales/services/sales.service';
import type { Supplier } from '@/features/suppliers/services/suppliers.service';

import {
  bool,
  fail,
  inDayRange,
  istanbulDay,
  money,
  notFound,
  now,
  num,
  paginate,
  requireFields,
  requireOwner,
  requirePerm,
  route,
  search,
  sortBy,
  str,
  uuid,
  type MockCtx,
} from '../core';
import { getDb } from '../db';
import {
  categoryByName,
  chargeFromSource,
  defaultAccount,
  FIN_CAT,
  financeAccount,
  moveStock,
  postCari,
  postFinance,
  voidCariEntry,
  voidFinanceBySource,
} from '../ops';

// ═══ Cari ═══════════════════════════════════════════════════════════════════

route('GET', '/v1/tenant/cari/meta', (ctx) => {
  requirePerm(ctx, 'tenant.cari.read');
  return { resource: 'cari', capabilities: { read: true, export: true, filter: true } };
});

route('GET', '/v1/tenant/cari/summary', (ctx) => {
  requirePerm(ctx, 'tenant.cari.read');
  const accounts = getDb().cariAccounts;
  return {
    total_receivable: money(accounts.reduce((s, a) => s + Math.max(0, num(a.balance)), 0)),
    account_count: accounts.length,
    with_balance_count: accounts.filter((a) => num(a.balance) !== 0).length,
  };
});

route('GET', '/v1/tenant/cari', (ctx) => {
  requirePerm(ctx, 'tenant.cari.read');
  let items = getDb().cariAccounts;
  if (ctx.query.is_active) items = items.filter((a) => String(a.is_active) === ctx.query.is_active);
  if (ctx.query.has_balance === 'true') items = items.filter((a) => num(a.balance) !== 0);
  if (ctx.query.has_balance === 'false') items = items.filter((a) => num(a.balance) === 0);
  items = search(items, ctx.query.q, ['customer_name', 'customer_phone']);
  return paginate(sortBy(items, ctx.query.sort, '-balance'), ctx.query);
});

route('POST', '/v1/tenant/cari/entries/:uuid/void', (ctx) => {
  requireOwner(ctx, 'tenant.cari.write');
  const db = getDb();
  const entry = db.cariEntries.find((e) => e.uuid === ctx.params.uuid);
  if (!entry) notFound('Entry');
  if (entry!.status === 'void') fail(409, 'CONFLICT', 'entry already void');
  if (entry!.type === 'charge' && db.jobs.some((j) => j.payments.some((p) => p.cari_entry_uuid === entry!.uuid))) {
    fail(409, 'CONFLICT', 'Void the job instead');
  }
  voidCariEntry(db, entry!);
  return entry;
});

function findCari(ctx: MockCtx) {
  const a = getDb().cariAccounts.find((x) => x.uuid === ctx.params.uuid);
  if (!a) notFound('Cari account');
  return a!;
}

route('GET', '/v1/tenant/cari/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.cari.read');
  const a = findCari(ctx);
  const c = getDb().customers.find((x) => x.uuid === a.customer_uuid);
  const detail: CariAccountDetail = {
    ...a,
    customer_email: c?.email ?? '',
    customer_tax_id: c?.tax_id,
    customer_tax_office: c?.tax_office,
    customer_is_active: c?.is_active ?? false,
  };
  return detail;
});

route('GET', '/v1/tenant/cari/:uuid/entries', (ctx) => {
  requirePerm(ctx, 'tenant.cari.read');
  const a = findCari(ctx);
  const q = ctx.query;
  let items = getDb().cariEntries.filter((e) => e.account_uuid === a.uuid);
  if (q.type) items = items.filter((e) => e.type === q.type);
  if (q.status) items = items.filter((e) => e.status === q.status);
  if (q.date_from || q.date_to) items = items.filter((e) => inDayRange(e.entry_date + 'T12:00:00Z', q.date_from, q.date_to));
  return paginate(sortBy(items, q.sort, '-entry_date,-created_at'), q);
});

function entryBase(ctx: MockCtx) {
  const errors: { field: string; message: string }[] = [];
  if (!(num(ctx.body.amount) > 0)) errors.push({ field: 'amount', message: 'must be > 0' });
  if (!ctx.body.entry_date) errors.push({ field: 'entry_date', message: 'required' });
  return errors;
}

route('POST', '/v1/tenant/cari/:uuid/charges', (ctx) => {
  requireOwner(ctx, 'tenant.cari.write');
  const errors = entryBase(ctx);
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);
  const a = findCari(ctx);
  return postCari(getDb(), a, {
    type: 'charge',
    amount: money(num(ctx.body.amount)),
    delta: num(ctx.body.amount),
    entry_date: str(ctx.body.entry_date),
    description: str(ctx.body.description),
    reference_no: str(ctx.body.reference_no) || null,
  });
});

route('POST', '/v1/tenant/cari/:uuid/payments', (ctx) => {
  requireOwner(ctx, 'tenant.cari.write');
  const errors = entryBase(ctx);
  if (!ctx.body.finance_account_uuid) errors.push({ field: 'finance_account_uuid', message: 'required' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);
  const db = getDb();
  const a = findCari(ctx);
  const amount = num(ctx.body.amount);
  const account = financeAccount(db, str(ctx.body.finance_account_uuid));
  const method = str(ctx.body.payment_method, 'cash') || 'cash';
  const txn = postFinance(db, {
    type: 'income',
    accountUuid: account.uuid,
    categoryUuid: categoryByName(db, FIN_CAT.cariCollection, 'income').uuid,
    amount,
    date: str(ctx.body.entry_date),
    description: str(ctx.body.description) || `Cari tahsilat · ${a.customer_name}`,
    paymentMethod: method,
    referenceNo: str(ctx.body.reference_no) || null,
    sourceType: 'cari_payment',
  });
  const entry = postCari(db, a, {
    type: 'payment',
    amount: money(amount),
    delta: -amount,
    entry_date: str(ctx.body.entry_date),
    description: str(ctx.body.description),
    reference_no: str(ctx.body.reference_no) || null,
    payment_method: method,
    finance_account_uuid: account.uuid,
    finance_account_name: account.name,
    finance_transaction_uuid: txn.uuid,
  });
  txn.source_uuid = entry.uuid;
  return entry;
});

route('POST', '/v1/tenant/cari/:uuid/adjustments', (ctx) => {
  requireOwner(ctx, 'tenant.cari.write');
  const errors = entryBase(ctx);
  const direction = str(ctx.body.direction);
  if (direction !== 'increase' && direction !== 'decrease') errors.push({ field: 'direction', message: 'invalid' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);
  const amount = num(ctx.body.amount);
  const entry = postCari(getDb(), findCari(ctx), {
    type: 'adjustment',
    amount: money(amount),
    delta: direction === 'decrease' ? -amount : amount,
    entry_date: str(ctx.body.entry_date),
    description: str(ctx.body.description),
    reference_no: str(ctx.body.reference_no) || null,
  });
  (entry as CariEntry & { _direction?: string })._direction = direction;
  return entry;
});

// ═══ Sales ══════════════════════════════════════════════════════════════════

route('GET', '/v1/tenant/sales/meta', (ctx) => {
  requirePerm(ctx, 'tenant.sales.read');
  return { resource: 'sales', capabilities: { read: true, create: ctx.permissions.has('tenant.sales.write'), export: true } };
});

route('GET', '/v1/tenant/sales/summary', (ctx) => {
  requirePerm(ctx, 'tenant.sales.read');
  const date = ctx.query.date || istanbulDay();
  const sales = getDb().sales.filter((s) => s.status === 'posted' && istanbulDay(s.sold_at) === date);
  const by = (m: string) => money(sales.filter((s) => s.method === m).reduce((t, s) => t + num(s.total_amount), 0));
  const total = sales.reduce((t, s) => t + num(s.total_amount), 0);
  const summary: SalesSummary = {
    sale_count: sales.length,
    card_total: by('card'),
    cari_total: by('cari'),
    net_total: money(total),
    paid_total: money(sales.filter((s) => s.method !== 'cari').reduce((t, s) => t + num(s.total_amount), 0)),
    date,
  };
  return summary;
});

route('GET', '/v1/tenant/sales', (ctx) => {
  requirePerm(ctx, 'tenant.sales.read');
  const q = ctx.query;
  let items = getDb().sales;
  if (q.status) items = items.filter((s) => s.status === q.status);
  if (q.date_from || q.date_to) items = items.filter((s) => inDayRange(s.sold_at, q.date_from, q.date_to));
  items = search(items, q.q, ['customer_name', 'customer_phone', (s) => s.lines.map((l) => l.name).join(' ')]);
  const page = paginate(sortBy(items, q.sort, '-sold_at'), q);
  return { ...page, items: page.items.map(({ lines: _l, ...rest }) => rest) };
});

route('POST', '/v1/tenant/sales', (ctx) => {
  requirePerm(ctx, 'tenant.sales.write');
  const db = getDb();
  const b = ctx.body;
  const method = str(b.method);
  const lines = Array.isArray(b.lines) ? (b.lines as { product_uuid: string; unit_price?: string; qty?: string }[]) : [];
  const errors: { field: string; message: string }[] = [];
  if (!['cash', 'card', 'cari'].includes(method)) errors.push({ field: 'method', message: 'invalid' });
  if (!lines.length) errors.push({ field: 'lines', message: 'at least one product is required' });
  if (method === 'cari' && !b.customer_uuid) errors.push({ field: 'customer_uuid', message: 'required for cari' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);

  const customer = b.customer_uuid ? db.customers.find((c) => c.uuid === b.customer_uuid) : null;
  if (b.customer_uuid && !customer) notFound('Customer');
  const soldAt = str(b.sold_at) || now();
  const saleLines = lines.map((l, i) => {
    const p = db.products.find((x) => x.uuid === l.product_uuid && x.is_active);
    if (!p) fail(400, 'VALIDATION_ERROR', 'Product not found', [{ field: `lines[${i}].product_uuid`, message: 'not found' }]);
    const qty = num(l.qty ?? 1);
    const price = l.unit_price != null && l.unit_price !== '' ? num(l.unit_price) : num(p!.sale_price);
    if (!(qty > 0)) fail(400, 'VALIDATION_ERROR', 'qty must be positive', [{ field: `lines[${i}].qty`, message: 'must be > 0' }]);
    if (p!.track_stock && num(p!.stock_quantity) < qty) {
      fail(409, 'INSUFFICIENT_STOCK', `Not enough stock for ${p!.name}`, [{ field: `lines[${i}].qty`, message: 'insufficient stock' }]);
    }
    return {
      uuid: uuid(),
      product_uuid: p!.uuid,
      name: p!.name,
      unit_price: money(price),
      qty: String(qty),
      vat_rate: p!.vat_rate,
      line_total: money(price * qty),
      currency: 'TRY',
      sort_order: i,
    };
  });
  const total = saleLines.reduce((s, l) => s + num(l.line_total), 0);
  const sale: SaleDetail = {
    uuid: uuid(),
    customer_uuid: customer?.uuid ?? null,
    customer_name: customer?.name ?? '',
    customer_phone: customer?.phone ?? '',
    status: 'posted',
    currency: 'TRY',
    total_amount: money(total),
    method: method as SaleDetail['method'],
    finance_account_uuid: null,
    finance_account_name: null,
    finance_transaction_uuid: null,
    cari_entry_uuid: null,
    notes: str(b.notes),
    sold_at: soldAt,
    created_at: now(),
    voided_at: null,
    lines: saleLines,
  };
  const description = `Ürün satışı · ${saleLines.map((l) => l.name).join(', ')}`;
  if (method === 'cari') {
    sale.cari_entry_uuid = chargeFromSource(db, customer!.uuid, total, description).uuid;
  } else {
    const account = b.finance_account_uuid ? financeAccount(db, str(b.finance_account_uuid)) : defaultAccount(db, method);
    const txn = postFinance(db, {
      type: 'income',
      accountUuid: account.uuid,
      categoryUuid: categoryByName(db, FIN_CAT.productSale, 'income').uuid,
      amount: total,
      date: istanbulDay(soldAt),
      description,
      paymentMethod: method,
      sourceType: 'product_sale',
      sourceUuid: sale.uuid,
    });
    sale.finance_account_uuid = account.uuid;
    sale.finance_account_name = account.name;
    sale.finance_transaction_uuid = txn.uuid;
  }
  for (const l of saleLines) moveStock(db, l.product_uuid, -num(l.qty));
  db.sales.push(sale);
  return sale;
});

function findSale(ctx: MockCtx) {
  const s = getDb().sales.find((x) => x.uuid === ctx.params.uuid);
  if (!s) notFound('Sale');
  return s!;
}

route('GET', '/v1/tenant/sales/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.sales.read');
  return findSale(ctx);
});

route('POST', '/v1/tenant/sales/:uuid/void', (ctx) => {
  requireOwner(ctx, 'tenant.sales.write');
  const db = getDb();
  const sale = findSale(ctx);
  if (sale.status === 'voided') fail(409, 'CONFLICT', 'Sale already voided');
  if (sale.cari_entry_uuid) {
    const entry = db.cariEntries.find((e) => e.uuid === sale.cari_entry_uuid);
    if (entry && entry.status === 'posted') voidCariEntry(db, entry);
  } else {
    voidFinanceBySource(db, 'product_sale', sale.uuid);
  }
  for (const l of sale.lines) moveStock(db, l.product_uuid, num(l.qty));
  sale.status = 'voided';
  sale.voided_at = now();
  return sale;
});

// ═══ Suppliers ══════════════════════════════════════════════════════════════

route('GET', '/v1/tenant/suppliers/meta', (ctx) => {
  requirePerm(ctx, 'tenant.suppliers.read');
  return { resource: 'suppliers', capabilities: { read: true, create: ctx.permissions.has('tenant.suppliers.write'), export: true } };
});

route('GET', '/v1/tenant/suppliers', (ctx) => {
  requirePerm(ctx, 'tenant.suppliers.read');
  let items = getDb().suppliers;
  if (ctx.query.is_active) items = items.filter((s) => String(s.is_active) === ctx.query.is_active);
  items = search(items, ctx.query.q, ['name', 'phone', 'email', 'tax_id']);
  return paginate(sortBy(items, ctx.query.sort, 'name'), ctx.query);
});

function findSupplier(ctx: MockCtx) {
  const s = getDb().suppliers.find((x) => x.uuid === ctx.params.uuid);
  if (!s) notFound('Supplier');
  return s!;
}

route('POST', '/v1/tenant/suppliers', (ctx) => {
  requireOwner(ctx, 'tenant.suppliers.write');
  requireFields(ctx.body, ['name']);
  const s: Supplier = {
    uuid: uuid(),
    name: str(ctx.body.name).trim(),
    phone: str(ctx.body.phone),
    email: str(ctx.body.email),
    tax_id: str(ctx.body.tax_id),
    notes: str(ctx.body.notes),
    is_active: bool(ctx.body.is_active, true),
    created_at: now(),
    updated_at: now(),
  };
  getDb().suppliers.push(s);
  return s;
});

route('GET', '/v1/tenant/suppliers/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.suppliers.read');
  return findSupplier(ctx);
});

route('PATCH', '/v1/tenant/suppliers/:uuid', (ctx) => {
  requireOwner(ctx, 'tenant.suppliers.write');
  const s = findSupplier(ctx);
  if (ctx.body.name !== undefined) {
    if (!str(ctx.body.name).trim()) fail(400, 'VALIDATION_ERROR', 'Name is required', [{ field: 'name', message: 'required' }]);
    s.name = str(ctx.body.name).trim();
  }
  for (const k of ['phone', 'email', 'tax_id', 'notes'] as const) if (ctx.body[k] !== undefined) s[k] = str(ctx.body[k]);
  if (ctx.body.is_active !== undefined) s.is_active = bool(ctx.body.is_active);
  s.updated_at = now();
  for (const p of getDb().purchases) if (p.supplier_uuid === s.uuid) p.supplier_name = s.name;
  return s;
});

route('DELETE', '/v1/tenant/suppliers/:uuid', (ctx) => {
  requireOwner(ctx, 'tenant.suppliers.write');
  const s = findSupplier(ctx);
  const db = getDb();
  if (db.purchases.some((p) => p.supplier_uuid === s.uuid && p.status === 'posted')) {
    fail(409, 'CONFLICT', 'Supplier has posted purchases');
  }
  db.suppliers = db.suppliers.filter((x) => x !== s);
  return { deleted: true };
});

// ═══ Purchases ══════════════════════════════════════════════════════════════

route('GET', '/v1/tenant/purchases/meta', (ctx) => {
  requirePerm(ctx, 'tenant.purchases.read');
  return { resource: 'purchases', capabilities: { read: true, create: ctx.permissions.has('tenant.purchases.write'), export: true } };
});

route('GET', '/v1/tenant/purchases', (ctx) => {
  requirePerm(ctx, 'tenant.purchases.read');
  const q = ctx.query;
  let items = getDb().purchases;
  if (q.status) items = items.filter((p) => p.status === q.status);
  if (q.supplier_uuid) items = items.filter((p) => p.supplier_uuid === q.supplier_uuid);
  if (q.date_from || q.date_to) items = items.filter((p) => inDayRange(p.purchased_at, q.date_from, q.date_to));
  items = search(items, q.q, ['supplier_name', (p) => p.lines.map((l) => l.name).join(' ')]);
  return paginate(sortBy(items, q.sort, '-purchased_at'), q);
});

route('POST', '/v1/tenant/purchases', (ctx) => {
  requireOwner(ctx, 'tenant.purchases.write');
  const db = getDb();
  const b = ctx.body;
  const lines = Array.isArray(b.lines) ? (b.lines as { product_uuid: string; unit_cost?: string; qty?: string }[]) : [];
  const errors: { field: string; message: string }[] = [];
  if (!b.supplier_uuid) errors.push({ field: 'supplier_uuid', message: 'required' });
  if (!['cash', 'card'].includes(str(b.method))) errors.push({ field: 'method', message: 'invalid' });
  if (!b.finance_account_uuid) errors.push({ field: 'finance_account_uuid', message: 'required' });
  if (!lines.length) errors.push({ field: 'lines', message: 'at least one product is required' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);
  const supplier = db.suppliers.find((s) => s.uuid === b.supplier_uuid && s.is_active);
  if (!supplier) notFound('Supplier');
  const account = financeAccount(db, str(b.finance_account_uuid));
  const purchasedAt = str(b.purchased_at) || now();
  const purchaseLines = lines.map((l, i) => {
    const p = db.products.find((x) => x.uuid === l.product_uuid);
    if (!p) fail(400, 'VALIDATION_ERROR', 'Product not found', [{ field: `lines[${i}].product_uuid`, message: 'not found' }]);
    const qty = num(l.qty ?? 1);
    const cost = l.unit_cost != null && l.unit_cost !== '' ? num(l.unit_cost) : num(p!.cost_price);
    if (!(qty > 0)) fail(400, 'VALIDATION_ERROR', 'qty must be positive', [{ field: `lines[${i}].qty`, message: 'must be > 0' }]);
    return { uuid: uuid(), product_uuid: p!.uuid, name: p!.name, unit_cost: money(cost), qty: String(qty), line_total: money(cost * qty), currency: 'TRY', sort_order: i };
  });
  const total = purchaseLines.reduce((s, l) => s + num(l.line_total), 0);
  const purchase: PurchaseDetail = {
    uuid: uuid(),
    supplier_uuid: supplier!.uuid,
    supplier_name: supplier!.name,
    status: 'posted',
    currency: 'TRY',
    total_amount: money(total),
    method: str(b.method) as PurchaseDetail['method'],
    finance_account_uuid: account.uuid,
    finance_account_name: account.name,
    finance_transaction_uuid: null,
    notes: str(b.notes),
    purchased_at: purchasedAt,
    created_at: now(),
    voided_at: null,
    lines: purchaseLines,
  };
  purchase.finance_transaction_uuid = postFinance(db, {
    type: 'expense',
    accountUuid: account.uuid,
    categoryUuid: categoryByName(db, FIN_CAT.stockPurchase, 'expense').uuid,
    amount: total,
    date: istanbulDay(purchasedAt),
    description: `Stok alımı · ${supplier!.name}`,
    paymentMethod: str(b.method),
    sourceType: 'purchase',
    sourceUuid: purchase.uuid,
  }).uuid;
  for (const l of purchaseLines) moveStock(db, l.product_uuid, num(l.qty));
  db.purchases.push(purchase);
  return purchase;
});

function findPurchase(ctx: MockCtx) {
  const p = getDb().purchases.find((x) => x.uuid === ctx.params.uuid);
  if (!p) notFound('Purchase');
  return p!;
}

route('GET', '/v1/tenant/purchases/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.purchases.read');
  return findPurchase(ctx);
});

route('POST', '/v1/tenant/purchases/:uuid/void', (ctx) => {
  requireOwner(ctx, 'tenant.purchases.write');
  const db = getDb();
  const p = findPurchase(ctx);
  if (p.status === 'voided') fail(409, 'CONFLICT', 'Purchase already voided');
  voidFinanceBySource(db, 'purchase', p.uuid);
  for (const l of p.lines) moveStock(db, l.product_uuid, -num(l.qty));
  p.status = 'voided';
  p.voided_at = now();
  return p;
});

