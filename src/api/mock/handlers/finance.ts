import type {
  FinanceAccount,
  FinanceCategory,
  FinanceSourceDetail,
  FinanceSummary,
  FinanceTransaction,
} from '@/features/finance/services/finance.service';

import { bool, fail, inDayRange, istanbulDay, type MockCtx, money, notFound, now, num, omitNulls, paginate, requireFields, requireOwner, requirePerm, resourceMeta, route, search, sortBy, str, uuid } from '../core';
import { getDb } from '../db';
import { postFinance, voidFinance } from '../ops';

const read = 'tenant.finance.read';
const write = 'tenant.finance.write';

function monthStart() {
  return `${istanbulDay().slice(0, 7)}-01`;
}

route('GET', '/v1/tenant/finance/summary', (ctx) => {
  requirePerm(ctx, read);
  const db = getDb();
  const from = ctx.query.date_from || monthStart();
  const to = ctx.query.date_to || istanbulDay();
  const posted = db.transactions.filter((t) => t.status === 'posted' && inDayRange(t.transaction_date + 'T12:00:00Z', from, to));
  const income = posted.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.amount), 0);
  const expense = posted.filter((t) => t.type === 'expense').reduce((s, t) => s + num(t.amount), 0);
  const byCat = new Map<string, { category_uuid: string; category_name: string; total: number }>();
  for (const t of posted.filter((x) => x.type === 'expense' && x.category_uuid)) {
    const row = byCat.get(t.category_uuid!) ?? { category_uuid: t.category_uuid!, category_name: t.category_name ?? '', total: 0 };
    row.total += num(t.amount);
    byCat.set(t.category_uuid!, row);
  }
  const summary: FinanceSummary = {
    date_from: from,
    date_to: to,
    currency: 'TRY',
    total_income: money(income),
    total_expense: money(expense),
    net: money(income - expense),
    accounts: db.financeAccounts.filter((a) => a.is_active),
    expense_by_category: [...byCat.values()].sort((a, b) => b.total - a.total).map((r) => ({ ...r, total: money(r.total) })),
  };
  return summary;
});

// ─── Accounts ──────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/finance/accounts/meta', (ctx) => {
  requirePerm(ctx, read);
  return resourceMeta('tenant.finance.accounts', 'name', { read: true, create: ctx.permissions.has(write), update: ctx.permissions.has(write), search: true, sort: true, export: true, import: true });
});

route('GET', '/v1/tenant/finance/accounts', (ctx) => {
  requirePerm(ctx, read);
  let items = getDb().financeAccounts;
  if (ctx.query.is_active) items = items.filter((a) => String(a.is_active) === ctx.query.is_active);
  items = search(items, ctx.query.q, ['name', 'bank_name', 'iban']);
  return paginate(sortBy(items, ctx.query.sort, 'type,name'), ctx.query, 50);
});

function findAccount(ctx: MockCtx) {
  const a = getDb().financeAccounts.find((x) => x.uuid === ctx.params.uuid);
  if (!a) notFound('Account');
  return a!;
}

route('POST', '/v1/tenant/finance/accounts', (ctx) => {
  requireOwner(ctx, write);
  requireFields(ctx.body, ['name', 'type']);
  const type = str(ctx.body.type);
  if (type !== 'cash' && type !== 'bank') fail(400, 'VALIDATION_ERROR', 'Invalid type', [{ field: 'type', message: 'invalid' }]);
  // Backend: currency must be a 3-letter ISO code (upper-cased), names are unique among active accounts.
  const currency = (str(ctx.body.currency, 'TRY') || 'TRY').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail(400, 'VALIDATION_ERROR', 'currency must be ISO 4217 code', [{ field: 'currency', message: 'invalid' }]);
  const opening = num(ctx.body.opening_balance);
  const db = getDb();
  const name = str(ctx.body.name).trim();
  if (db.financeAccounts.some((x) => x.is_active && x.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
    fail(409, 'CONFLICT', 'Account name already exists', [{ field: 'name', message: 'duplicate' }]);
  }
  const a: FinanceAccount = {
    uuid: uuid(),
    name,
    type: type as FinanceAccount['type'],
    currency,
    opening_balance: money(opening),
    current_balance: money(opening),
    is_default: bool(ctx.body.is_default),
    is_active: bool(ctx.body.is_active, true),
    bank_name: str(ctx.body.bank_name) || null,
    iban: str(ctx.body.iban) || null,
    notes: str(ctx.body.notes),
    negative_balance: opening < 0,
    created_at: now(),
    updated_at: now(),
  };
  if (a.is_default) for (const x of db.financeAccounts) x.is_default = false;
  db.financeAccounts.push(a);
  return a;
});

route('GET', '/v1/tenant/finance/accounts/:uuid/detail', (ctx) => {
  requirePerm(ctx, read);
  const a = findAccount(ctx);
  const db = getDb();
  const rows = db.transactions.filter((t) => t.account_uuid === a.uuid || t.counter_account_uuid === a.uuid);
  const posted = rows.filter((t) => t.status === 'posted');
  const sum = (f: (t: FinanceTransaction) => boolean) => money(posted.filter(f).reduce((s, t) => s + num(t.amount), 0));
  return {
    account: a,
    stats: {
      posted_count: posted.length,
      void_count: rows.length - posted.length,
      total_income: sum((t) => t.type === 'income'),
      total_expense: sum((t) => t.type === 'expense'),
      transfer_in: sum((t) => t.type === 'transfer' && t.counter_account_uuid === a.uuid),
      transfer_out: sum((t) => t.type === 'transfer' && t.account_uuid === a.uuid),
    },
    recent_transactions: sortBy(rows, '-transaction_date,-created_at').slice(0, num(ctx.query.limit) || 10).map(txnOut),
  };
});

route('GET', '/v1/tenant/finance/accounts/:uuid', (ctx) => {
  requirePerm(ctx, read);
  return findAccount(ctx);
});

route('PATCH', '/v1/tenant/finance/accounts/:uuid', (ctx) => {
  requireOwner(ctx, write);
  const a = findAccount(ctx);
  const db = getDb();
  const b = ctx.body;
  if (b.name !== undefined) a.name = str(b.name).trim() || a.name;
  if (b.bank_name !== undefined) a.bank_name = str(b.bank_name) || null;
  if (b.iban !== undefined) a.iban = str(b.iban) || null;
  if (b.notes !== undefined) a.notes = str(b.notes);
  if (b.is_active !== undefined) a.is_active = bool(b.is_active);
  if (b.is_default !== undefined) {
    if (bool(b.is_default)) for (const x of db.financeAccounts) x.is_default = false;
    a.is_default = bool(b.is_default);
  }
  a.updated_at = now();
  for (const t of db.transactions) {
    if (t.account_uuid === a.uuid) t.account_name = a.name;
    if (t.counter_account_uuid === a.uuid) t.counter_account_name = a.name;
  }
  return a;
});

route('DELETE', '/v1/tenant/finance/accounts/:uuid', (ctx) => {
  requireOwner(ctx, write);
  const a = findAccount(ctx);
  const db = getDb();
  if (db.transactions.some((t) => t.account_uuid === a.uuid || t.counter_account_uuid === a.uuid)) {
    fail(409, 'CONFLICT', 'Account has transactions; deactivate it instead');
  }
  db.financeAccounts = db.financeAccounts.filter((x) => x !== a);
  return { deleted: true };
});

// ─── Categories ────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/finance/categories/meta', (ctx) => {
  requirePerm(ctx, read);
  return resourceMeta('tenant.finance.categories', 'name', { read: true, create: ctx.permissions.has(write), update: ctx.permissions.has(write), search: true, filter: true, sort: true, export: true, import: true });
});

route('GET', '/v1/tenant/finance/categories', (ctx) => {
  requirePerm(ctx, read);
  let items = getDb().financeCategories;
  if (ctx.query.kind) items = items.filter((c) => c.kind === ctx.query.kind);
  if (ctx.query.is_active) items = items.filter((c) => String(c.is_active) === ctx.query.is_active);
  return { items: sortBy(items, 'kind,sort_order,name') };
});

function findCategory(ctx: MockCtx) {
  const c = getDb().financeCategories.find((x) => x.uuid === ctx.params.uuid);
  if (!c) notFound('Category');
  return c!;
}

route('POST', '/v1/tenant/finance/categories', (ctx) => {
  requireOwner(ctx, write);
  requireFields(ctx.body, ['name', 'kind']);
  const kind = str(ctx.body.kind);
  if (kind !== 'income' && kind !== 'expense') fail(400, 'VALIDATION_ERROR', 'Invalid kind', [{ field: 'kind', message: 'invalid' }]);
  const db = getDb();
  if (db.financeCategories.some((c) => c.kind === kind && c.name.toLocaleLowerCase('tr') === str(ctx.body.name).trim().toLocaleLowerCase('tr'))) {
    fail(409, 'CONFLICT', 'Category already exists', [{ field: 'name', message: 'duplicate' }]);
  }
  const c: FinanceCategory = {
    uuid: uuid(),
    name: str(ctx.body.name).trim(),
    kind: kind as FinanceCategory['kind'],
    parent_uuid: (ctx.body.parent_uuid as string) || null,
    sort_order: num(ctx.body.sort_order) || db.financeCategories.length,
    is_active: bool(ctx.body.is_active, true),
    created_at: now(),
    updated_at: now(),
  };
  db.financeCategories.push(c);
  return c;
});

route('GET', '/v1/tenant/finance/categories/:uuid/detail', (ctx) => {
  requirePerm(ctx, read);
  const c = findCategory(ctx);
  const rows = getDb().transactions.filter((t) => t.category_uuid === c.uuid);
  const posted = rows.filter((t) => t.status === 'posted');
  return {
    category: c,
    stats: { posted_count: posted.length, void_count: rows.length - posted.length, total_amount: money(posted.reduce((s, t) => s + num(t.amount), 0)) },
    recent_transactions: sortBy(rows, '-transaction_date,-created_at').slice(0, num(ctx.query.limit) || 10).map(txnOut),
  };
});

route('GET', '/v1/tenant/finance/categories/:uuid', (ctx) => {
  requirePerm(ctx, read);
  return findCategory(ctx);
});

route('PATCH', '/v1/tenant/finance/categories/:uuid', (ctx) => {
  requireOwner(ctx, write);
  const c = findCategory(ctx);
  const db = getDb();
  const b = ctx.body;
  if (b.name !== undefined) {
    const name = str(b.name).trim();
    if (!name) fail(400, 'VALIDATION_ERROR', 'Validation failed', [{ field: 'name', message: 'required' }]);
    if (db.financeCategories.some((x) => x !== c && x.kind === c.kind && x.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
      fail(409, 'CONFLICT', 'Category already exists', [{ field: 'name', message: 'duplicate' }]);
    }
    c.name = name;
  }
  if (b.sort_order !== undefined) c.sort_order = Math.trunc(num(b.sort_order));
  if (b.is_active !== undefined) c.is_active = bool(b.is_active);
  if (b.parent_uuid !== undefined) {
    const parent = str(b.parent_uuid);
    if (parent === c.uuid) fail(400, 'VALIDATION_ERROR', 'category cannot be its own parent', [{ field: 'parent_uuid', message: 'invalid' }]);
    if (parent && !db.financeCategories.some((x) => x.uuid === parent)) notFound('Parent category');
    c.parent_uuid = parent || null;
  }
  for (const t of db.transactions) if (t.category_uuid === c.uuid) t.category_name = c.name;
  c.updated_at = now();
  return c;
});

route('DELETE', '/v1/tenant/finance/categories/:uuid', (ctx) => {
  requireOwner(ctx, write);
  const c = findCategory(ctx);
  const db = getDb();
  // Backend soft-deletes; posted rows keep their category name snapshot.
  db.financeCategories = db.financeCategories.filter((x) => x !== c);
  return { deleted: true };
});

// ─── Transactions ──────────────────────────────────────────────────────────

/** Go `finance.Transaction` omits nil pointers (`omitempty`) instead of sending null. */
const TXN_OPTIONAL = ['counter_account_uuid', 'counter_account_name', 'category_uuid', 'category_name', 'reference_no', 'source_uuid', 'voided_at'] as const;
export const txnOut = (t: FinanceTransaction) => omitNulls(t, TXN_OPTIONAL as unknown as (keyof FinanceTransaction)[]);

route('GET', '/v1/tenant/finance/transactions/meta', (ctx) => {
  requirePerm(ctx, read);
  return resourceMeta('tenant.finance.transactions', '-transaction_date', { read: true, create: ctx.permissions.has(write), search: true, filter: true, sort: true, export: true });
});

route('GET', '/v1/tenant/finance/transactions', (ctx) => {
  requirePerm(ctx, read);
  const q = ctx.query;
  let items = getDb().transactions;
  if (q.type) items = items.filter((t) => t.type === q.type);
  if (q.status) items = items.filter((t) => t.status === q.status);
  if (q.account_uuid) items = items.filter((t) => t.account_uuid === q.account_uuid || t.counter_account_uuid === q.account_uuid);
  if (q.category_uuid) items = items.filter((t) => t.category_uuid === q.category_uuid);
  if (q.source_type) items = items.filter((t) => t.source_type === q.source_type);
  if (q.currency) items = items.filter((t) => t.currency.toUpperCase() === q.currency.trim().toUpperCase());
  if (q.date_from || q.date_to) items = items.filter((t) => inDayRange(t.transaction_date + 'T12:00:00Z', q.date_from, q.date_to));
  items = search(items, q.q, ['description', 'reference_no', 'account_name', 'category_name']);
  const page = paginate(sortBy(items, q.sort, '-transaction_date,-created_at'), q);
  return { ...page, items: page.items.map(txnOut) };
});

function sourceDetail(t: FinanceTransaction): FinanceSourceDetail | null {
  const db = getDb();
  if (t.source_type === 'service_job') {
    const job = db.jobs.find((j) => j.payments.some((p) => p.uuid === t.source_uuid));
    if (!job) return null;
    return {
      kind: 'service_job',
      uuid: job.uuid,
      title: job.customer_name,
      subtitle: job.vehicle_label,
      plate: job.plate,
      date: job.started_at,
      total: job.total_amount,
      currency: job.currency,
      lines: job.lines.map((l) => ({ type: 'service', name: l.name, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total })),
    };
  }
  if (t.source_type === 'product_sale') {
    const sale = db.sales.find((s) => s.uuid === t.source_uuid);
    if (!sale) return null;
    return {
      kind: 'product_sale',
      uuid: sale.uuid,
      title: sale.customer_name || '—',
      date: sale.sold_at,
      total: sale.total_amount,
      currency: sale.currency,
      lines: sale.lines.map((l) => ({ type: 'product', name: l.name, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total })),
    };
  }
  if (t.source_type === 'purchase') {
    const p = db.purchases.find((x) => x.uuid === t.source_uuid);
    if (!p) return null;
    return {
      kind: 'purchase',
      uuid: p.uuid,
      title: p.supplier_name,
      date: p.purchased_at,
      total: p.total_amount,
      currency: p.currency,
      lines: p.lines.map((l) => ({ type: 'product', name: l.name, qty: l.qty, unit_price: l.unit_cost, line_total: l.line_total })),
    };
  }
  if (t.source_type === 'cari_payment') {
    const entry = db.cariEntries.find((e) => e.uuid === t.source_uuid);
    const account = entry && db.cariAccounts.find((a) => a.uuid === entry.account_uuid);
    if (!entry || !account) return null;
    return { kind: 'cari_payment', uuid: account.uuid, title: account.customer_name, date: entry.entry_date, total: entry.amount, currency: 'TRY', lines: [] };
  }
  return null;
}

route('GET', '/v1/tenant/finance/transactions/:uuid', (ctx) => {
  requirePerm(ctx, read);
  const t = getDb().transactions.find((x) => x.uuid === ctx.params.uuid);
  if (!t) notFound('Transaction');
  const detail = sourceDetail(t!);
  return detail ? { ...txnOut(t!), source_detail: detail } : txnOut(t!);
});

function validateManual(ctx: MockCtx, needsCategory: boolean) {
  const b = ctx.body;
  const errors: { field: string; message: string }[] = [];
  if (!b.account_uuid) errors.push({ field: 'account_uuid', message: 'required' });
  if (!(num(b.amount) > 0)) errors.push({ field: 'amount', message: 'must be > 0' });
  if (!b.transaction_date) errors.push({ field: 'transaction_date', message: 'required' });
  if (needsCategory && !b.category_uuid) errors.push({ field: 'category_uuid', message: 'required' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);
}

route('POST', '/v1/tenant/finance/transactions', (ctx) => {
  requireOwner(ctx, write);
  const type = str(ctx.body.type);
  if (type !== 'income' && type !== 'expense') fail(400, 'VALIDATION_ERROR', 'Invalid type', [{ field: 'type', message: 'invalid' }]);
  validateManual(ctx, type === 'expense');
  const db = getDb();
  if (!db.financeAccounts.some((a) => a.uuid === ctx.body.account_uuid && a.is_active)) fail(404, 'NOT_FOUND', 'Account not found');
  const cat = ctx.body.category_uuid ? db.financeCategories.find((c) => c.uuid === ctx.body.category_uuid) : null;
  if (ctx.body.category_uuid && (!cat || cat.kind !== type)) {
    fail(400, 'VALIDATION_ERROR', 'Category kind mismatch', [{ field: 'category_uuid', message: 'invalid' }]);
  }
  return txnOut(postFinance(db, {
    type: type as 'income' | 'expense',
    accountUuid: str(ctx.body.account_uuid),
    categoryUuid: cat?.uuid ?? null,
    amount: num(ctx.body.amount),
    date: str(ctx.body.transaction_date),
    description: str(ctx.body.description),
    paymentMethod: str(ctx.body.payment_method, 'cash') || 'cash',
    referenceNo: str(ctx.body.reference_no) || null,
  }));
});

route('POST', '/v1/tenant/finance/transactions/:uuid/void', (ctx) => {
  requireOwner(ctx, write);
  const db = getDb();
  const t = db.transactions.find((x) => x.uuid === ctx.params.uuid);
  if (!t) notFound('Transaction');
  if (t!.status === 'void') fail(409, 'CONFLICT', 'Transaction already void');
  if (t!.source_type && t!.source_type !== 'manual') fail(409, 'CONFLICT', 'Void the source document instead');
  return txnOut(voidFinance(db, t!));
});

route('POST', '/v1/tenant/finance/transfers', (ctx) => {
  requireOwner(ctx, write);
  const b = ctx.body;
  const errors: { field: string; message: string }[] = [];
  if (!b.from_account_uuid) errors.push({ field: 'from_account_uuid', message: 'required' });
  if (!b.to_account_uuid) errors.push({ field: 'to_account_uuid', message: 'required' });
  if (b.from_account_uuid && b.from_account_uuid === b.to_account_uuid) errors.push({ field: 'to_account_uuid', message: 'must differ' });
  if (!(num(b.amount) > 0)) errors.push({ field: 'amount', message: 'must be > 0' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);
  const db = getDb();
  const from = db.financeAccounts.find((a) => a.uuid === b.from_account_uuid);
  const to = db.financeAccounts.find((a) => a.uuid === b.to_account_uuid);
  if (!from) notFound('Source account');
  if (!to) notFound('Destination account');
  if (from!.currency !== to!.currency) fail(400, 'CURRENCY_MISMATCH', 'Accounts must share the same currency');
  return txnOut(postFinance(db, {
    type: 'transfer',
    accountUuid: str(b.from_account_uuid),
    counterAccountUuid: str(b.to_account_uuid),
    amount: num(b.amount),
    date: str(b.transaction_date) || istanbulDay(),
    description: str(b.description),
    paymentMethod: 'transfer',
    referenceNo: str(b.reference_no) || null,
  }));
});
