import type {
  ReportsNamedTotal,
  ReportsOverview,
  ReportsTimeseriesPoint,
} from '@/features/reports/services/reports.service';

import { inDayRange, istanbulDay, money, num, requirePerm, resourceMeta, route } from '../core';
import { getDb } from '../db';

function bucketKey(day: string, granularity: string) {
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  if (granularity === 'week') {
    const d = new Date(`${day}T12:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Monday start
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  return day;
}

function addNamed(map: Map<string, ReportsNamedTotal & { _t: number; _q: number }>, key: string, name: string, amount: number, qty = 0) {
  const row = map.get(key) ?? { key, name, total: '0', count: 0, qty: '0', _t: 0, _q: 0 };
  row._t += amount;
  row._q += qty;
  row.count += 1;
  map.set(key, row);
}

const finish = (map: Map<string, ReportsNamedTotal & { _t: number; _q: number }>, limit = 10) =>
  [...map.values()]
    .sort((a, b) => b._t - a._t)
    .slice(0, limit)
    .map(({ _t, _q, ...r }) => ({ ...r, total: money(_t), qty: _q ? String(Math.round(_q * 100) / 100) : r.qty }));

route('GET', '/v1/tenant/reports/meta', (ctx) => {
  requirePerm(ctx, 'tenant.reports.read');
  return resourceMeta('tenant.reports', '-date_to', { read: true, filter: true, export: ctx.permissions.has('tenant.reports.export') });
});

route('GET', '/v1/tenant/reports/overview', (ctx) => {
  requirePerm(ctx, 'tenant.reports.read');
  const db = getDb();
  const q = ctx.query;
  const to = q.date_to || istanbulDay();
  const from = q.date_from || istanbulDay(new Date(Date.now() - 29 * 86400000));
  const granularity = q.granularity || 'day';

  const txns = db.transactions.filter(
    (t) =>
      t.status === 'posted' &&
      t.type !== 'transfer' &&
      inDayRange(`${t.transaction_date}T12:00:00Z`, from, to) &&
      (!q.payment_method || t.payment_method === q.payment_method) &&
      (!q.account_uuid || t.account_uuid === q.account_uuid) &&
      (!q.source_type || t.source_type === q.source_type),
  );
  const jobs = db.jobs.filter((j) => j._org === ctx.orgUuid && inDayRange(j.started_at, from, to));
  const liveJobs = jobs.filter((j) => j.status !== 'cancelled' && j.status !== 'voided');
  const paidJobs = liveJobs.filter((j) => j.payment_status === 'paid');
  const sales = db.sales.filter((s) => s.status === 'posted' && inDayRange(s.sold_at, from, to));
  const purchases = db.purchases.filter((p) => p.status === 'posted' && inDayRange(p.purchased_at, from, to));
  const cariEntries = db.cariEntries.filter((e) => e.status === 'posted' && inDayRange(`${e.entry_date}T12:00:00Z`, from, to));

  const income = txns.filter((t) => t.type === 'income');
  const expense = txns.filter((t) => t.type === 'expense');
  const sum = (arr: { amount: string }[]) => arr.reduce((s, t) => s + num(t.amount), 0);
  const jobPaidTotal = paidJobs.reduce((s, j) => s + num(j.total_amount), 0);
  const cariCharged = sum(cariEntries.filter((e) => e.type === 'charge'));
  const cariCollected = sum(cariEntries.filter((e) => e.type === 'payment'));

  // Timeseries with empty buckets filled
  const series = new Map<string, ReportsTimeseriesPoint & { _i: number; _e: number; _j: number }>();
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    const k = bucketKey(cursor.toISOString().slice(0, 10), granularity);
    if (!series.has(k)) series.set(k, { date: k, income: '0', expense: '0', net: '0', job_paid: '0', job_count: 0, _i: 0, _e: 0, _j: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const t of txns) {
    const row = series.get(bucketKey(t.transaction_date, granularity));
    if (!row) continue;
    if (t.type === 'income') row._i += num(t.amount);
    else row._e += num(t.amount);
  }
  for (const j of liveJobs) {
    const row = series.get(bucketKey(istanbulDay(j.started_at), granularity));
    if (!row) continue;
    row.job_count += 1;
    if (j.payment_status === 'paid') row._j += num(j.total_amount);
  }
  const timeseries = [...series.values()].map(({ _i, _e, _j, ...r }) => ({
    ...r,
    income: money(_i),
    expense: money(_e),
    net: money(_i - _e),
    job_paid: money(_j),
  }));

  const services = new Map();
  for (const j of liveJobs) for (const l of j.lines) addNamed(services, l.service_uuid ?? l.name, l.name, num(l.line_total), num(l.qty));
  const products = new Map();
  for (const s of sales) for (const l of s.lines) addNamed(products, l.product_uuid, l.name, num(l.line_total), num(l.qty));
  const expCats = new Map();
  for (const t of expense) addNamed(expCats, t.category_uuid ?? 'none', t.category_name ?? '—', num(t.amount));
  const incCats = new Map();
  for (const t of income) addNamed(incCats, t.category_uuid ?? 'none', t.category_name ?? '—', num(t.amount));
  const methods = new Map();
  for (const t of income) addNamed(methods, t.payment_method, t.payment_method, num(t.amount));
  for (const j of paidJobs) for (const p of j.payments) if (p.method === 'cari' && p.status === 'posted') addNamed(methods, 'cari', 'cari', num(p.amount));

  const sourceMap = new Map<string, { source_type: string; type: string; total: number; count: number }>();
  for (const t of txns) {
    const key = `${t.source_type ?? 'manual'}:${t.type}`;
    const row = sourceMap.get(key) ?? { source_type: t.source_type ?? 'manual', type: t.type, total: 0, count: 0 };
    row.total += num(t.amount);
    row.count += 1;
    sourceMap.set(key, row);
  }

  const top = new Map<string, { customer_uuid: string; customer_name: string; t: number; c: number }>();
  for (const j of liveJobs) {
    const row = top.get(j.customer_uuid) ?? { customer_uuid: j.customer_uuid, customer_name: j.customer_name, t: 0, c: 0 };
    row.t += num(j.total_amount);
    row.c += 1;
    top.set(j.customer_uuid, row);
  }

  const cashTotal = sum(income.filter((t) => t.payment_method === 'cash'));
  const cardTotal = sum(income.filter((t) => t.payment_method === 'card'));

  const overview: ReportsOverview = {
    filters: {
      date_from: from,
      date_to: to,
      currency: q.currency ?? null,
      payment_method: q.payment_method ?? null,
      account_uuid: q.account_uuid ?? null,
      source_type: q.source_type ?? null,
      granularity,
    },
    kpis: {
      total_income: money(sum(income)),
      total_expense: money(sum(expense)),
      net_profit: money(sum(income) - sum(expense)),
      income_count: income.length,
      expense_count: expense.length,
      job_count: liveJobs.length,
      job_paid_count: paidJobs.length,
      job_done_count: liveJobs.filter((j) => j.status === 'ready' || j.status === 'delivered').length,
      job_in_progress_count: liveJobs.filter((j) => j.status === 'in_progress').length,
      job_cancelled_count: jobs.filter((j) => j.status === 'cancelled').length,
      job_paid_total: money(jobPaidTotal),
      avg_ticket: money(paidJobs.length ? jobPaidTotal / paidJobs.length : 0),
      vehicles_served: new Set(liveJobs.map((j) => j.vehicle_uuid)).size,
      sale_count: sales.length,
      sale_total: money(sales.reduce((s, x) => s + num(x.total_amount), 0)),
      purchase_count: purchases.length,
      purchase_total: money(purchases.reduce((s, x) => s + num(x.total_amount), 0)),
      cari_charged: money(cariCharged),
      cari_collected: money(cariCollected),
      cari_outstanding: money(db.cariAccounts.reduce((s, a) => s + Math.max(0, num(a.balance)), 0)),
      cari_charge_count: cariEntries.filter((e) => e.type === 'charge').length,
      cari_payment_count: cariEntries.filter((e) => e.type === 'payment').length,
      cash_total: money(cashTotal),
      card_total: money(cardTotal),
      cari_payment_total: money(cariCollected),
    },
    timeseries,
    services: finish(services),
    products: finish(products),
    expenses_by_category: finish(expCats),
    income_by_category: finish(incCats),
    payments_by_method: finish(methods),
    revenue_by_source: [...sourceMap.values()].sort((a, b) => b.total - a.total).map((r) => ({ ...r, total: money(r.total) })),
    cari_receivables: db.cariAccounts
      .filter((a) => num(a.balance) > 0)
      .sort((a, b) => num(b.balance) - num(a.balance))
      .slice(0, 10)
      .map((a) => ({
        account_uuid: a.uuid,
        customer_uuid: a.customer_uuid,
        customer_name: a.customer_name,
        customer_phone: a.customer_phone,
        currency: a.currency,
        balance: a.balance,
        last_entry_date: db.cariEntries.filter((e) => e.account_uuid === a.uuid).map((e) => e.entry_date).sort().pop() ?? null,
      })),
    top_customers: [...top.values()]
      .sort((a, b) => b.t - a.t)
      .slice(0, 10)
      .map((r) => ({ customer_uuid: r.customer_uuid, customer_name: r.customer_name, job_total: money(r.t), job_count: r.c })),
    generated_at: new Date().toISOString(),
  };
  return overview;
});
