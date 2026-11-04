/**
 * Domain operations shared by the seed and the route handlers, mirroring backend use cases:
 * finance postings by source, cari charge/payment, stock moves, job totals.
 * Keeping them in one place keeps balances consistent whatever path created the row.
 */
import type { CariAccount, CariEntry } from '@/features/cari/services/cari.service';
import type { FinanceTransaction } from '@/features/finance/services/finance.service';

import { fail, istanbulDay, money, num, uuid } from './core';
import { getDb, type MockDb } from './db';

export const FIN_CAT = {
  serviceIncome: 'Hizmet Geliri',
  productSale: 'Ürün Satışı',
  cariCollection: 'Cari Tahsilat',
  stockPurchase: 'Stok Alımı',
} as const;

export function categoryByName(db: MockDb, name: string, kind: 'income' | 'expense') {
  let cat = db.financeCategories.find((c) => c.name === name && c.kind === kind);
  if (!cat) {
    const at = new Date().toISOString();
    cat = { uuid: uuid(), name, kind, parent_uuid: null, sort_order: db.financeCategories.length, is_active: true, created_at: at, updated_at: at };
    db.financeCategories.push(cat);
  }
  return cat;
}

export function financeAccount(db: MockDb, accountUuid: string | null | undefined) {
  const account = db.financeAccounts.find((a) => a.uuid === accountUuid && a.is_active);
  if (!account) fail(400, 'VALIDATION_ERROR', 'Finance account is required', [{ field: 'finance_account_uuid', message: 'required' }]);
  return account!;
}

export function defaultAccount(db: MockDb, method: 'cash' | 'card' | string) {
  const want = method === 'card' ? 'bank' : 'cash';
  return (
    db.financeAccounts.find((a) => a.is_active && a.type === want && a.is_default) ??
    db.financeAccounts.find((a) => a.is_active && a.type === want) ??
    db.financeAccounts.find((a) => a.is_active)!
  );
}

function applyBalance(db: MockDb, accountUuid: string, delta: number) {
  const account = db.financeAccounts.find((a) => a.uuid === accountUuid);
  if (!account) return;
  const next = num(account.current_balance) + delta;
  account.current_balance = money(next);
  account.negative_balance = next < 0;
  account.updated_at = new Date().toISOString();
}

export type PostFinanceInput = {
  type: 'income' | 'expense' | 'transfer';
  accountUuid: string;
  counterAccountUuid?: string | null;
  categoryUuid?: string | null;
  amount: number;
  date: string;
  description: string;
  paymentMethod: string;
  referenceNo?: string | null;
  sourceType?: FinanceTransaction['source_type'];
  sourceUuid?: string | null;
  at?: string;
};

export function postFinance(db: MockDb, input: PostFinanceInput): FinanceTransaction {
  if (!(input.amount > 0)) fail(400, 'VALIDATION_ERROR', 'Amount must be positive', [{ field: 'amount', message: 'must be > 0' }]);
  const account = db.financeAccounts.find((a) => a.uuid === input.accountUuid)!;
  const counter = input.counterAccountUuid ? db.financeAccounts.find((a) => a.uuid === input.counterAccountUuid) : null;
  const category = input.categoryUuid ? db.financeCategories.find((c) => c.uuid === input.categoryUuid) : null;
  const at = input.at ?? new Date().toISOString();
  const txn: FinanceTransaction = {
    uuid: uuid(),
    type: input.type,
    status: 'posted',
    account_uuid: account.uuid,
    account_name: account.name,
    counter_account_uuid: counter?.uuid ?? null,
    counter_account_name: counter?.name ?? null,
    category_uuid: category?.uuid ?? null,
    category_name: category?.name ?? null,
    amount: money(input.amount),
    currency: account.currency,
    transaction_date: input.date,
    description: input.description,
    reference_no: input.referenceNo ?? null,
    payment_method: input.paymentMethod,
    source_type: input.sourceType ?? 'manual',
    source_uuid: input.sourceUuid ?? null,
    created_at: at,
    updated_at: at,
    voided_at: null,
  };
  db.transactions.push(txn);
  if (input.type === 'income') applyBalance(db, account.uuid, input.amount);
  else if (input.type === 'expense') applyBalance(db, account.uuid, -input.amount);
  else if (counter) {
    applyBalance(db, account.uuid, -input.amount);
    applyBalance(db, counter.uuid, input.amount);
  }
  return txn;
}

export function voidFinance(db: MockDb, txn: FinanceTransaction) {
  if (txn.status === 'void') return txn;
  txn.status = 'void';
  txn.voided_at = new Date().toISOString();
  txn.updated_at = txn.voided_at;
  const amount = num(txn.amount);
  if (txn.type === 'income') applyBalance(db, txn.account_uuid, -amount);
  else if (txn.type === 'expense') applyBalance(db, txn.account_uuid, amount);
  else if (txn.counter_account_uuid) {
    applyBalance(db, txn.account_uuid, amount);
    applyBalance(db, txn.counter_account_uuid, -amount);
  }
  return txn;
}

export function voidFinanceBySource(db: MockDb, sourceType: string, sourceUuid: string) {
  for (const t of db.transactions) if (t.source_type === sourceType && t.source_uuid === sourceUuid) voidFinance(db, t);
}

// ─── Cari ──────────────────────────────────────────────────────────────────

export function cariAccountFor(db: MockDb, customerUuid: string): CariAccount {
  let account = db.cariAccounts.find((a) => a.customer_uuid === customerUuid);
  const customer = db.customers.find((c) => c.uuid === customerUuid);
  if (!customer) fail(404, 'NOT_FOUND', 'Customer not found');
  if (!account) {
    const at = new Date().toISOString();
    account = {
      uuid: uuid(),
      customer_uuid: customer!.uuid,
      customer_name: customer!.name,
      customer_phone: customer!.phone,
      customer_kind: customer!.kind,
      currency: 'TRY',
      balance: '0.00',
      is_active: true,
      created_at: at,
      updated_at: at,
    };
    db.cariAccounts.push(account);
    customer!.cari_account_uuid = account.uuid;
  }
  return account;
}

function setCariBalance(db: MockDb, account: CariAccount, next: number) {
  account.balance = money(next);
  account.updated_at = new Date().toISOString();
  const customer = db.customers.find((c) => c.uuid === account.customer_uuid);
  if (customer) {
    customer.cari_balance = account.balance;
    customer.cari_account_uuid = account.uuid;
  }
}

/** Positive delta = receivable grows (charge). */
export function postCari(
  db: MockDb,
  account: CariAccount,
  entry: Omit<CariEntry, 'uuid' | 'account_uuid' | 'status' | 'balance_after' | 'created_at' | 'voided_at'> & {
    delta: number;
    at?: string;
  },
): CariEntry {
  const next = num(account.balance) + entry.delta;
  setCariBalance(db, account, next);
  const at = entry.at ?? new Date().toISOString();
  const row: CariEntry = {
    uuid: uuid(),
    account_uuid: account.uuid,
    type: entry.type,
    status: 'posted',
    amount: entry.amount,
    balance_after: money(next),
    entry_date: entry.entry_date,
    description: entry.description,
    reference_no: entry.reference_no ?? null,
    payment_method: entry.payment_method ?? null,
    finance_account_uuid: entry.finance_account_uuid ?? null,
    finance_account_name: entry.finance_account_name ?? null,
    finance_transaction_uuid: entry.finance_transaction_uuid ?? null,
    created_at: at,
    voided_at: null,
  };
  db.cariEntries.push(row);
  return row;
}

export function cariEntryDelta(entry: CariEntry & { _direction?: 'increase' | 'decrease' }) {
  const amount = num(entry.amount);
  if (entry.type === 'payment') return -amount;
  if (entry.type === 'adjustment') return entry._direction === 'decrease' ? -amount : amount;
  return amount;
}

export function voidCariEntry(db: MockDb, entry: CariEntry) {
  if (entry.status === 'void') fail(409, 'CONFLICT', 'Entry already void');
  const account = db.cariAccounts.find((a) => a.uuid === entry.account_uuid)!;
  entry.status = 'void';
  entry.voided_at = new Date().toISOString();
  setCariBalance(db, account, num(account.balance) - cariEntryDelta(entry));
  if (entry.finance_transaction_uuid) {
    const txn = db.transactions.find((t) => t.uuid === entry.finance_transaction_uuid);
    if (txn) voidFinance(db, txn);
  }
}

/** Charge the customer's cari from a document (job / sale). Returns the entry. */
export function chargeFromSource(db: MockDb, customerUuid: string, amount: number, description: string, at?: string) {
  const account = cariAccountFor(db, customerUuid);
  return postCari(db, account, {
    type: 'charge',
    amount: money(amount),
    delta: amount,
    entry_date: istanbulDay(at ?? new Date()),
    description,
    at,
  });
}

// ─── Stock ─────────────────────────────────────────────────────────────────

export function moveStock(db: MockDb, productUuid: string, delta: number) {
  const p = db.products.find((x) => x.uuid === productUuid);
  if (!p || !p.track_stock) return;
  const next = num(p.stock_quantity) + delta;
  p.stock_quantity = money(next).replace(/\.00$/, '');
  const min = num(p.min_stock_alert);
  p.stock_status = next <= 0 ? 'out_of_stock' : min > 0 && next <= min ? 'low_stock' : 'in_stock';
  p.updated_at = new Date().toISOString();
}

export const db = getDb;
