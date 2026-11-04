/**
 * Finance helpers shared by the finance screens (port of web `features/finance/lib/*`).
 * Dates are business days (`YYYY-MM-DD`, Europe/Istanbul) like the web `financeToday()` / `financeMonthStart()`.
 */
import type { FinanceSourceDetail, FinanceTransaction } from '@/features/finance/services/finance.service';
import { localToday } from '@/features/jobs/lib/job-ui';
import { businessMonthStart } from '@/lib/business-date';

export { localToday as financeToday };

export function financeMonthStart() {
  return businessMonthStart();
}

export const TX_TYPES = ['income', 'expense', 'transfer'] as const;
export const TX_STATUSES = ['posted', 'void'] as const;
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
export const CURRENCIES = ['TRY', 'USD', 'EUR'] as const;

export const txnStatusKey = (status: string) => (status === 'void' ? 'finance.transactions.status_void' : 'finance.transactions.status_posted');
export const txnStatusHintKey = (status: string) =>
  status === 'void' ? 'finance.transactions.status_void_hint' : 'finance.transactions.status_posted_hint';
export const categoryKindKey = (kind: string) => (kind === 'income' ? 'finance.categories.kind_income' : 'finance.categories.kind_expense');

/** Mobile route of the document behind a finance row (web `sourceHref`). */
export function sourceRoute(d: FinanceSourceDetail): string {
  switch (d.kind) {
    case 'service_job':
      return `/jobs/${d.uuid}`;
    case 'product_sale':
      return `/sales/${d.uuid}`;
    case 'purchase':
      return `/purchases/${d.uuid}`;
    case 'cari_payment':
      return `/cari/${d.uuid}`;
  }
}

/** Short document id shown on the transaction report (web: first 8 chars upper-cased). */
export const reportId = (tx: Pick<FinanceTransaction, 'uuid'>) => tx.uuid.slice(0, 8).toUpperCase();

/** Normalises a user-typed amount ("1.250,50" / "1250,5") to the API decimal string. */
export function normalizeAmount(raw: string) {
  const v = raw.trim();
  if (!v) return '';
  return v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
}
