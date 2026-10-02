import type { Job, JobDetail, JobsSummary } from '@/features/jobs/services/jobs.service';

import { fail, inDayRange, istanbulDay, type MockCtx, money, notFound, now, num, paginate, requireOwner, requirePerm, resourceMeta, route, search, sortBy, str, uuid } from '../core';
import { getDb, type MockDb } from '../db';
import {
  chargeFromSource,
  categoryByName,
  defaultAccount,
  FIN_CAT,
  financeAccount,
  moveStock,
  postFinance,
  voidCariEntry,
  voidFinanceBySource,
} from '../ops';

type Row = MockDb['jobs'][number];

export function toListItem(job: Row): Job {
  const { lines: _l, payments: _p, consumptions: _c, material_cost: _m, _org, ...rest } = job;
  return rest;
}

export function toDetail(job: Row): JobDetail {
  const { _org, ...rest } = job;
  return rest;
}

function findJob(ctx: MockCtx) {
  const job = getDb().jobs.find((j) => j.uuid === ctx.params.uuid && j._org === ctx.orgUuid);
  if (!job) notFound('Job');
  return job!;
}

function recalcMaterial(job: Row) {
  job.material_cost = money(job.consumptions.filter((c) => !c.reverted).reduce((s, c) => s + num(c.total_cost), 0));
}

function staffName(db: MockDb, userUuid: string | null | undefined) {
  const u = db.users.find((x) => x.uuid === userUuid);
  return u ? `${u.name} ${u.surname}` : '';
}

function applyJobFilters(ctx: MockCtx, items: Row[]) {
  const q = ctx.query;
  let out = items;
  if (q.status) {
    const set = new Set(q.status.split(','));
    out = out.filter((j) => set.has(j.status));
  }
  if (q.payment_status) out = out.filter((j) => j.payment_status === q.payment_status);
  if (q.assignee_uuid) out = out.filter((j) => j.assignee_uuid === q.assignee_uuid);
  if (q.date_from || q.date_to) {
    const includeOpen = q.include_open === 'true' || q.include_open === '1';
    out = out.filter(
      (j) =>
        inDayRange(j.started_at, q.date_from, q.date_to) ||
        (includeOpen && (j.status === 'in_progress' || j.status === 'ready') && istanbulDay(j.started_at) < (q.date_from ?? '')),
    );
  }
  out = search(out, q.q, ['plate', 'customer_name', 'customer_phone', 'assignee_name', 'vehicle_label']);
  return sortBy(out, q.sort, '-started_at');
}

route('GET', '/v1/tenant/jobs/meta', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  return resourceMeta('tenant.jobs', '-started_at', { read: true, create: ctx.permissions.has('tenant.jobs.write'), update: ctx.permissions.has('tenant.jobs.write'), search: true, filter: true, sort: true, export: true });
});

route('GET', '/v1/tenant/jobs/summary', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  const date = ctx.query.date || istanbulDay();
  const jobs = getDb().jobs.filter((j) => j._org === ctx.orgUuid && istanbulDay(j.started_at) === date && j.status !== 'cancelled' && j.status !== 'voided');
  const paid = jobs.filter((j) => j.payment_status === 'paid');
  const byMethod = (m: string) =>
    paid.reduce((s, j) => s + j.payments.filter((p) => p.method === m && p.status === 'posted').reduce((a, p) => a + num(p.amount), 0), 0);
  const summary: JobsSummary = {
    job_count: jobs.length,
    card_total: money(byMethod('card')),
    cari_total: money(byMethod('cari')),
    net_total: money(jobs.reduce((s, j) => s + num(j.total_amount), 0)),
    paid_total: money(paid.reduce((s, j) => s + num(j.total_amount), 0)),
    date,
  };
  return summary;
});

route('GET', '/v1/tenant/jobs', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  const items = applyJobFilters(ctx, getDb().jobs.filter((j) => j._org === ctx.orgUuid));
  const page = paginate(items, ctx.query, 20);
  return { ...page, items: page.items.map(toListItem) };
});

route('POST', '/v1/tenant/jobs', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.write');
  const db = getDb();
  const b = ctx.body;
  const lines = Array.isArray(b.lines) ? (b.lines as { service_uuid?: string; unit_price?: string; qty?: string }[]) : [];
  const errors: { field: string; message: string }[] = [];
  if (!b.customer_uuid) errors.push({ field: 'customer_uuid', message: 'required' });
  if (!b.vehicle_uuid) errors.push({ field: 'vehicle_uuid', message: 'required' });
  if (!lines.length) errors.push({ field: 'lines', message: 'at least one service line is required' });
  if (errors.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', errors);

  const customer = db.customers.find((c) => c.uuid === b.customer_uuid);
  if (!customer) fail(404, 'NOT_FOUND', 'Customer not found');
  const vehicle = db.vehicles.find((v) => v.uuid === b.vehicle_uuid && v.customer_uuid === customer!.uuid);
  if (!vehicle) fail(404, 'NOT_FOUND', 'Vehicle not found');
  if (b.assignee_uuid && !db.memberships.some((m) => m.userUuid === b.assignee_uuid && m.orgUuid === ctx.orgUuid)) {
    fail(400, 'VALIDATION_ERROR', 'Assignee is not a member', [{ field: 'assignee_uuid', message: 'not a member' }]);
  }

  const startedAt = str(b.started_at) || now();
  const jobLines = lines.map((l, i) => {
    const s = db.services.find((x) => x.uuid === l.service_uuid);
    if (!s) fail(400, 'VALIDATION_ERROR', 'Service not found', [{ field: `lines[${i}].service_uuid`, message: 'not found' }]);
    const price = l.unit_price != null && l.unit_price !== '' ? num(l.unit_price) : num(s!.price);
    const qty = l.qty ? num(l.qty) : 1;
    if (price < 0 || qty <= 0) fail(400, 'VALIDATION_ERROR', 'Invalid line', [{ field: `lines[${i}]`, message: 'invalid price or qty' }]);
    return {
      uuid: uuid(),
      line_type: 'service',
      service_uuid: s!.uuid,
      name: s!.name,
      unit_price: money(price),
      qty: String(qty),
      vat_rate: s!.vat_rate,
      line_total: money(price * qty),
      currency: 'TRY',
      sort_order: i,
    };
  });

  const services = jobLines.map((l) => {
    const s = db.services.find((x) => x.uuid === l.service_uuid)!;
    return { uuid: s.uuid, name: s.name, color: s.color ?? '' };
  });

  const job: Row = {
    _org: ctx.orgUuid!,
    uuid: uuid(),
    customer_uuid: customer!.uuid,
    vehicle_uuid: vehicle!.uuid,
    customer_name: customer!.name,
    customer_phone: customer!.phone,
    plate: vehicle!.plate,
    vehicle_label: `${vehicle!.brand_name} ${vehicle!.model_name} · ${vehicle!.year}`,
    status: 'in_progress',
    payment_status: 'unpaid',
    currency: 'TRY',
    notes: str(b.notes),
    total_amount: money(jobLines.reduce((s, l) => s + num(l.line_total), 0)),
    assignee_uuid: (b.assignee_uuid as string) || null,
    assignee_name: staffName(db, b.assignee_uuid as string),
    brand_name: vehicle!.brand_name,
    brand_logo_url: null,
    services,
    started_at: startedAt,
    completed_at: null,
    delivered_at: null,
    paid_at: null,
    created_at: now(),
    updated_at: now(),
    lines: jobLines,
    payments: [],
    consumptions: [],
    material_cost: '0.00',
  };

  // Expand service recipes into consumptions and take tracked products out of stock.
  for (const line of jobLines) {
    for (const r of db.serviceProducts.filter((x) => x.service_uuid === line.service_uuid)) {
      const p = db.products.find((x) => x.uuid === r.product_uuid);
      if (!p || !p.is_active) continue;
      const qty = num(r.qty) * num(line.qty);
      job.consumptions.push({
        uuid: uuid(),
        product_uuid: p.uuid,
        name: p.name,
        unit: p.unit,
        qty: String(qty),
        unit_cost: p.cost_price,
        total_cost: money(num(p.cost_price) * qty),
        service_name: line.name,
        stock_applied: p.track_stock,
        reverted: false,
      });
      if (p.track_stock) moveStock(db, p.uuid, -qty);
    }
  }
  recalcMaterial(job);
  db.jobs.push(job);
  return toDetail(job);
});

route('GET', '/v1/tenant/jobs/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  return toDetail(findJob(ctx));
});

route('PATCH', '/v1/tenant/jobs/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.write');
  const db = getDb();
  const job = findJob(ctx);
  if (ctx.body.notes === undefined && ctx.body.assignee_uuid === undefined) fail(400, 'VALIDATION_ERROR', 'Nothing to update');
  if (job.status === 'cancelled' || job.status === 'voided') fail(409, 'CONFLICT', 'Job is closed');
  if (ctx.body.notes !== undefined) job.notes = str(ctx.body.notes);
  if (ctx.body.assignee_uuid !== undefined) {
    const a = ctx.body.assignee_uuid as string | null;
    if (a && !db.memberships.some((m) => m.userUuid === a && m.orgUuid === ctx.orgUuid)) {
      fail(400, 'VALIDATION_ERROR', 'Assignee is not a member', [{ field: 'assignee_uuid', message: 'not a member' }]);
    }
    job.assignee_uuid = a || null;
    job.assignee_name = staffName(db, a);
  }
  job.updated_at = now();
  return toDetail(job);
});

const transition = (ctx: MockCtx, from: string[], apply: (job: Row) => void) => {
  requirePerm(ctx, 'tenant.jobs.write');
  const job = findJob(ctx);
  if (!from.includes(job.status)) fail(409, 'CONFLICT', `Job cannot move from ${job.status}`);
  apply(job);
  job.updated_at = now();
  return toDetail(job);
};

const markReady = (ctx: MockCtx) =>
  transition(ctx, ['in_progress'], (job) => {
    job.status = 'ready';
    job.completed_at ??= now();
  });
route('POST', '/v1/tenant/jobs/:uuid/ready', markReady);
route('POST', '/v1/tenant/jobs/:uuid/done', markReady);

route('POST', '/v1/tenant/jobs/:uuid/deliver', (ctx) =>
  transition(ctx, ['ready', 'in_progress'], (job) => {
    job.status = 'delivered';
    job.completed_at ??= now();
    job.delivered_at = now();
  }),
);

route('POST', '/v1/tenant/jobs/:uuid/cancel', (ctx) =>
  transition(ctx, ['in_progress', 'ready'], (job) => {
    const db = getDb();
    job.status = 'cancelled';
    job.completed_at ??= now();
    for (const c of job.consumptions) {
      if (c.stock_applied && !c.reverted) moveStock(db, c.product_uuid, num(c.qty));
      c.reverted = true;
    }
    recalcMaterial(job);
  }),
);

route('POST', '/v1/tenant/jobs/:uuid/close', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.write');
  const db = getDb();
  const job = findJob(ctx);
  const method = str(ctx.body.method);
  if (!['cash', 'card', 'cari'].includes(method)) {
    fail(400, 'VALIDATION_ERROR', 'method must be cash, card, or cari', [{ field: 'method', message: 'invalid' }]);
  }
  if (job.payment_status === 'paid') fail(409, 'CONFLICT', 'Job already paid');
  if (!['in_progress', 'ready', 'delivered'].includes(job.status)) fail(409, 'CONFLICT', 'Job cannot be closed');
  const total = num(job.total_amount);
  if (!(total > 0)) fail(400, 'VALIDATION_ERROR', 'Job total must be positive');

  const at = now();
  const description = `${job.plate} · ${job.lines.map((l) => l.name).join(', ')}`;
  const payment: JobDetail['payments'][number] = {
    uuid: uuid(),
    method: method as 'cash' | 'card' | 'cari',
    amount: money(total),
    currency: 'TRY',
    status: 'posted',
    finance_account_uuid: null,
    finance_account_name: null,
    finance_transaction_uuid: null,
    cari_entry_uuid: null,
    created_at: at,
    voided_at: null,
  };
  if (method === 'cari') {
    payment.cari_entry_uuid = chargeFromSource(db, job.customer_uuid, total, description, at).uuid;
  } else {
    const account = ctx.body.finance_account_uuid ? financeAccount(db, str(ctx.body.finance_account_uuid)) : defaultAccount(db, method);
    const txn = postFinance(db, {
      type: 'income',
      accountUuid: account.uuid,
      categoryUuid: categoryByName(db, FIN_CAT.serviceIncome, 'income').uuid,
      amount: total,
      date: istanbulDay(at),
      description,
      paymentMethod: method,
      sourceType: 'service_job',
      sourceUuid: payment.uuid,
      at,
    });
    payment.finance_account_uuid = account.uuid;
    payment.finance_account_name = account.name;
    payment.finance_transaction_uuid = txn.uuid;
  }
  job.payments.push(payment);
  job.payment_status = 'paid';
  job.paid_at = at;
  job.completed_at ??= at;
  job.updated_at = at;
  return toDetail(job);
});

route('POST', '/v1/tenant/jobs/:uuid/void', (ctx) => {
  requireOwner(ctx, 'tenant.jobs.write');
  const db = getDb();
  const job = findJob(ctx);
  if (job.payment_status !== 'paid') fail(409, 'CONFLICT', 'Only paid jobs can be voided');
  for (const p of job.payments) {
    if (p.status !== 'posted') continue;
    if (p.method === 'cari' && p.cari_entry_uuid) {
      const entry = db.cariEntries.find((e) => e.uuid === p.cari_entry_uuid);
      if (entry && entry.status === 'posted') voidCariEntry(db, entry);
    } else {
      voidFinanceBySource(db, 'service_job', p.uuid);
    }
    p.status = 'void';
    p.voided_at = now();
  }
  for (const c of job.consumptions) {
    if (c.stock_applied && !c.reverted) moveStock(db, c.product_uuid, num(c.qty));
    c.reverted = true;
  }
  recalcMaterial(job);
  job.status = 'voided';
  job.updated_at = now();
  return toDetail(job);
});

// ─── Consumptions ──────────────────────────────────────────────────────────

function editable(ctx: MockCtx) {
  requirePerm(ctx, 'tenant.jobs.write');
  const job = findJob(ctx);
  if (job.status === 'cancelled' || job.status === 'voided') fail(409, 'CONFLICT', 'Products cannot be changed on a cancelled job');
  return job;
}

function parseQty(raw: unknown) {
  const q = num(str(raw).replace(',', '.'));
  if (!(q > 0)) fail(400, 'VALIDATION_ERROR', 'qty must be positive', [{ field: 'qty', message: 'must be > 0' }]);
  return q;
}

route('POST', '/v1/tenant/jobs/:uuid/consumptions', (ctx) => {
  const db = getDb();
  const job = editable(ctx);
  const qty = parseQty(ctx.body.qty);
  const p = db.products.find((x) => x.uuid === ctx.body.product_uuid);
  if (!p) notFound('Product');
  const existing = job.consumptions.find((c) => c.product_uuid === p!.uuid && !c.reverted);
  if (existing) {
    const next = num(existing.qty) + qty;
    existing.qty = String(next);
    existing.total_cost = money(next * num(existing.unit_cost));
    if (existing.stock_applied) moveStock(db, p!.uuid, -qty);
  } else {
    job.consumptions.push({
      uuid: uuid(),
      product_uuid: p!.uuid,
      name: p!.name,
      unit: p!.unit,
      qty: String(qty),
      unit_cost: p!.cost_price,
      total_cost: money(qty * num(p!.cost_price)),
      stock_applied: p!.track_stock,
      reverted: false,
    });
    if (p!.track_stock) moveStock(db, p!.uuid, -qty);
  }
  recalcMaterial(job);
  job.updated_at = now();
  return toDetail(job);
});

route('PATCH', '/v1/tenant/jobs/:uuid/consumptions/:cid', (ctx) => {
  const db = getDb();
  const job = editable(ctx);
  const row = job.consumptions.find((c) => c.uuid === ctx.params.cid && !c.reverted);
  if (!row) notFound('Consumption');
  const qty = parseQty(ctx.body.qty);
  if (row!.stock_applied) moveStock(db, row!.product_uuid, num(row!.qty) - qty);
  row!.qty = String(qty);
  row!.total_cost = money(qty * num(row!.unit_cost));
  recalcMaterial(job);
  job.updated_at = now();
  return toDetail(job);
});

route('DELETE', '/v1/tenant/jobs/:uuid/consumptions/:cid', (ctx) => {
  const db = getDb();
  const job = editable(ctx);
  const row = job.consumptions.find((c) => c.uuid === ctx.params.cid);
  if (!row) notFound('Consumption');
  if (row!.stock_applied && !row!.reverted) moveStock(db, row!.product_uuid, num(row!.qty));
  job.consumptions = job.consumptions.filter((c) => c !== row);
  recalcMaterial(job);
  job.updated_at = now();
  return toDetail(job);
});

route('GET', '/v1/tenant/customers/:uuid/jobs', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  const items = sortBy(
    getDb().jobs.filter((j) => j._org === ctx.orgUuid && j.customer_uuid === ctx.params.uuid),
    ctx.query.sort,
    '-started_at',
  );
  const page = paginate(items, ctx.query, 20);
  return { ...page, items: page.items.map(toListItem) };
});

// Staff options for assignee pickers (requires jobs.read).
route('GET', '/v1/tenant/staff/options', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  const db = getDb();
  const items = db.memberships
    .filter((m) => m.orgUuid === ctx.orgUuid)
    .map((m) => ({ m, u: db.users.find((u) => u.uuid === m.userUuid)! }))
    .filter(({ u }) => u && u.status === 'active')
    .map(({ m, u }) => ({ uuid: u.uuid, email: u.email, name: u.name, surname: u.surname, role: m.role, label: `${u.name} ${u.surname}` }));
  return { items };
});

