/**
 * The day's money and the widget snapshot (otopoly-go `finance/usecase/today.go`, `livepush/usecase/widgets.go`).
 *
 * - `GET /v1/tenant/finance/today`: the day's collections ("tahsilat") are every posted income of the
 *   Europe/Istanbul day — job cash/card payments, sales, cari collections, package / subscription sales,
 *   manual income. Transfers and voided rows never count; a job closed on cari posts no income.
 * - `GET /v1/tenant/live-activities/widget-snapshot`: the snapshot a widget push carries, filtered by the
 *   caller's permissions exactly like the backend (money only with finance read, …).
 */
import type { components } from '@/api/generated/api';
import { shiftDay } from '@/lib/business-date';

import { fail, istanbulDay, type MockCtx, money, num, requirePerm, route } from '../core';
import { getDb } from '../db';
import { upcomingEventsOf } from './calendar';
import { subscriptionRenewalsDue } from './loyalty';
import { reviewFollowUpsDue } from './reviews';

type Schemas = components['schemas'];
type FinanceToday = Schemas['FinanceToday'];
type WidgetSnapshot = Schemas['WidgetSnapshot'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUEUE_MAX = 12;
const DATA_BUDGET = 3000;

const bucket = (source?: string | null): keyof FinanceToday['by_source'] => {
  switch (source ?? '') {
    case 'service_job':
      return 'jobs';
    case 'product_sale':
      return 'sales';
    case 'cari_payment':
      return 'cari';
    case 'loyalty_package':
    case 'loyalty_subscription':
      return 'loyalty';
    case '':
    case 'manual':
      return 'manual';
    default:
      return 'other';
  }
};

/** Same definition as the backend DayMoney. */
export function financeToday(date: string, days: number, currency = 'TRY'): FinanceToday {
  const db = getDb();
  const posted = db.transactions.filter((t) => t.status === 'posted' && t.currency === currency);
  const income = posted.filter((t) => t.type === 'income' && t.transaction_date === date);
  const methods = { cash: 0, card: 0, transfer: 0, other: 0 };
  const sources = { jobs: 0, sales: 0, cari: 0, loyalty: 0, manual: 0, other: 0 };
  let total = 0;
  for (const t of income) {
    const v = num(t.amount);
    total += v;
    const m = t.payment_method === 'cash' || t.payment_method === 'card' || t.payment_method === 'transfer' ? t.payment_method : 'other';
    methods[m] += v;
    sources[bucket(t.source_type)] += v;
  }
  const dayTotal = (day: string, type: 'income' | 'expense') => posted.filter((t) => t.type === type && t.transaction_date === day).reduce((s, t) => s + num(t.amount), 0);
  const expense = dayTotal(date, 'expense');
  const series: FinanceToday['series'] = [];
  for (let i = days - 1; i >= 0 && days > 0; i--) {
    const day = shiftDay(date, -i);
    series.push({ date: day, collected_total: money(dayTotal(day, 'income')), expense_total: money(dayTotal(day, 'expense')) });
  }
  const mapMoney = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)])) as { [K in keyof T]: string };
  return {
    date,
    currency,
    collected_total: money(total),
    collected_count: income.length,
    by_method: mapMoney(methods),
    by_source: mapMoney(sources),
    expense_total: money(expense),
    net: money(total - expense),
    series,
    accounts: db.financeAccounts
      .filter((a) => a.is_active && a.currency === currency)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, 'tr'))
      .slice(0, 20)
      .map((a) => ({ uuid: a.uuid, name: a.name, type: a.type, currency: a.currency, balance: a.current_balance, is_default: a.is_default })),
  };
}

route('GET', '/v1/tenant/finance/today', (ctx) => {
  requirePerm(ctx, 'tenant.finance.read');
  const date = ctx.query.date || istanbulDay();
  if (!DAY_RE.test(date)) fail(400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD', [{ field: 'date', message: 'date must be YYYY-MM-DD' }]);
  const days = ctx.query.days === undefined || ctx.query.days === '' ? 7 : Number(ctx.query.days);
  if (!Number.isInteger(days) || days < 0 || days > 31) fail(400, 'VALIDATION_ERROR', 'days must be between 0 and 31', [{ field: 'days', message: 'days must be between 0 and 31' }]);
  return financeToday(date, days, (ctx.query.currency || 'TRY').toUpperCase());
});

/** Byte length as APNs / FCM count it. */
const utf8Length = (s: string) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length);

const clip = (s: string | null | undefined, n: number) => [...(s ?? '')].slice(0, n).join('');

/** The snapshot one member sees (backend widgetParts.build + fitWidgetSnapshot). */
export function widgetSnapshotFor(ctx: MockCtx, nowAt: Date = new Date()): WidgetSnapshot {
  const org = ctx.orgUuid ?? '';
  const can = (p: string) => ctx.permissions.has(p);
  const db = getDb();
  const today = istanbulDay(nowAt);
  const jobs = db.jobs.filter((j) => j._org === org);
  const startedToday = (iso?: string | null) => Boolean(iso) && istanbulDay(iso!) === today;
  const shown = jobs.filter((j) => startedToday(j.started_at) || j.status === 'in_progress' || j.status === 'ready' || (j.status === 'delivered' && startedToday(j.delivered_at)));
  const item = (j: (typeof jobs)[number]) => ({
    id: j.uuid,
    plate: j.plate,
    name: clip(j.customer_name, 40),
    vehicle: clip(j.vehicle_label, 40),
    status: j.status as 'in_progress' | 'ready',
    started_at: j.started_at ? new Date(j.started_at).toISOString().replace(/\.\d{3}Z$/, 'Z') : '',
  });
  const byStart = (a: { started_at: string }, b: { started_at: string }) => b.started_at.localeCompare(a.started_at);
  const ready = shown.filter((j) => j.status === 'ready').sort(byStart).map(item);
  const working = shown.filter((j) => j.status === 'in_progress').sort(byStart).map(item);
  const open = [...ready, ...working];
  const snap: WidgetSnapshot = {
    v: 1,
    date: today,
    at: nowAt.getTime(),
    counts: { in_progress: working.length, ready: ready.length, delivered: shown.filter((j) => j.status === 'delivered').length },
    queue: open.slice(0, QUEUE_MAX),
    more: Math.max(0, open.length - QUEUE_MAX),
  };
  if (can('tenant.finance.read')) {
    const m = financeToday(today, 7);
    const paidJobs = jobs.filter((j) => startedToday(j.started_at) && j.payment_status === 'paid' && j.status !== 'cancelled' && j.status !== 'voided');
    snap.money = {
      cur: m.currency,
      collected: m.collected_total,
      jobs: money(paidJobs.reduce((s, j) => s + num(j.total_amount), 0)),
      cash: m.by_method.cash,
      card: m.by_method.card,
      transfer: m.by_method.transfer,
      other: m.by_method.other,
      expense: m.expense_total,
      net: m.net,
      week: m.series.map((d) => d.collected_total),
      accounts: m.accounts.slice(0, 4).map((a) => ({ n: clip(a.name, 24), t: a.type, b: a.balance })),
    };
    snap.paid_total = m.collected_total;
  }
  const alerts: NonNullable<WidgetSnapshot['alerts']> = {};
  if (can('tenant.catalog.read')) alerts.stock = db.products.filter((p) => p.is_active && p.track_stock && num(p.min_stock_alert) > 0 && num(p.stock_quantity) <= num(p.min_stock_alert)).length;
  if (can('tenant.reviews.read')) alerts.reviews = reviewFollowUpsDue(org);
  if (can('tenant.loyalty.read')) alerts.renewals = subscriptionRenewalsDue(org, today, 7);
  alerts.unpaid = jobs.filter((j) => j.status === 'delivered' && j.payment_status === 'unpaid' && startedToday(j.delivered_at)).length;
  snap.alerts = alerts;
  if (can('tenant.calendar.read') || can('tenant.todos.read')) {
    const dayEnd = new Date(`${shiftDay(today, 1)}T00:00:00+03:00`);
    type Item = NonNullable<WidgetSnapshot['agenda']>['items'][number];
    const items: (Item & { _t: number })[] = [];
    if (can('tenant.calendar.read')) {
      for (const e of upcomingEventsOf(org, nowAt, dayEnd).slice(0, 6)) {
        const at = e.all_day ? '' : new Date(e.starts_at).toISOString().replace(/\.\d{3}Z$/, 'Z');
        items.push({ k: 'event', id: e.uuid, t: clip(e.title, 40), at, _t: at ? Date.parse(at) : Infinity });
      }
    }
    if (can('tenant.todos.read')) {
      const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Istanbul' }).format(nowAt);
      for (const t of db.todos.filter((x) => x.status === 'open' && x.due_date === today && (!x.due_time || x.due_time.slice(0, 5) >= clock)).slice(0, 6)) {
        const at = t.due_time ? new Date(`${today}T${t.due_time.slice(0, 5)}:00+03:00`).toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
        items.push({ k: 'todo', id: t.uuid, t: clip(t.title, 40), at, _t: at ? Date.parse(at) : Infinity });
      }
    }
    items.sort((a, b) => a._t - b._t);
    snap.agenda = { items: items.slice(0, 3).map(({ _t, ...rest }) => rest) };
  }
  // Same budget as the push: drop queue items until the data fits.
  const size = () => utf8Length(JSON.stringify({ kind: 'widgets.refresh', org, snapshot: snap }));
  while (size() > DATA_BUDGET && snap.queue.length > 0) {
    snap.queue = snap.queue.slice(0, -1);
    snap.more += 1;
  }
  return snap;
}

route('GET', '/v1/tenant/live-activities/widget-snapshot', (ctx) => {
  if (!ctx.user || !ctx.orgUuid) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  requirePerm(ctx, 'tenant.jobs.read');
  return widgetSnapshotFor(ctx);
});
