/**
 * Stock reorder suggestions and draft purchases (backend `modules/stockreorder`, purchases drafts).
 * Same formula as the Go use case:
 *   velocity  = (job consumptions not reverted + posted sales of the last N days) / N
 *   suggested = max(0, ceil(velocity × (lead + target) + min − stock − on_order)), whole packs when set
 */
import type { PurchaseDetail } from '@/features/purchases/services/purchases.service';
import type { ReorderProductOverride, ReorderSettings, ReorderSuggestion, ReorderSummary, ReorderUrgency } from '@/features/stock-reorder/types';

import { fail, istanbulDay, type MockCtx, money, notFound, now, num, requireOwner, requirePerm, route, str, uuid } from '../core';
import { getDb, type MockDb, type MockReorderOverride, type MockReorderState } from '../db';
import { categoryByName, FIN_CAT, financeAccount, moveStock, postFinance } from '../ops';

const FORMULA = 'max(0, ceil(velocity × (lead_days + target_days) + min_stock − stock − on_order)), rounded up to whole packs';
const VELOCITY_OPTIONS = [7, 14, 30, 60, 90];
const DAY = 24 * 60 * 60 * 1000;

type Override = MockReorderOverride;

/** Lazily created so a persisted mock DB from an older build keeps working. */
export function reorderState(db: MockDb): MockReorderState {
  db.reorder ??= { settings: { velocity_days: 30, lead_days: 3, target_days: 14, notify_enabled: true }, supplierLeads: {}, overrides: {} };
  return db.reorder;
}

const qty = (n: number) => {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
/** Ceil with float noise removed (0.1 × 30 is 3.0000000000000004). */
const ceil = (n: number) => Math.ceil(Math.round(n * 1e6) / 1e6);

function requireRead(ctx: MockCtx) {
  requirePerm(ctx, 'tenant.purchases.read');
  requirePerm(ctx, 'tenant.catalog.read');
}
function requireWrite(ctx: MockCtx) {
  requireRead(ctx);
  requireOwner(ctx, 'tenant.purchases.write');
}

function overrideOut(db: MockDb, o: Override | undefined): ReorderProductOverride | null {
  if (!o) return null;
  const sup = o.supplier_uuid ? db.suppliers.find((s) => s.uuid === o.supplier_uuid) : undefined;
  return { supplier_uuid: o.supplier_uuid, supplier_name: sup?.name ?? null, lead_days: o.lead_days, target_days: o.target_days, pack_size: o.pack_size };
}

function compute(db: MockDb): ReorderSuggestion[] {
  const st = reorderState(db);
  const set = st.settings;
  const since = Date.now() - set.velocity_days * DAY;
  const used = new Map<string, { consumed: number; sold: number }>();
  const bump = (id: string, key: 'consumed' | 'sold', n: number) => {
    const u = used.get(id) ?? { consumed: 0, sold: 0 };
    u[key] += n;
    used.set(id, u);
  };
  for (const job of db.jobs) {
    if (Date.parse(job.created_at) < since) continue;
    for (const c of job.consumptions ?? []) if (!c.reverted) bump(c.product_uuid, 'consumed', num(c.qty));
  }
  for (const sale of db.sales) {
    if (sale.status !== 'posted' || Date.parse(sale.sold_at) < since) continue;
    for (const l of sale.lines) if (l.product_uuid) bump(l.product_uuid, 'sold', num(l.qty));
  }
  const onOrder = new Map<string, number>();
  const last = new Map<string, { supplier_uuid: string; unit_cost: string; at: string }>();
  for (const p of db.purchases) {
    for (const l of p.lines) {
      if (p.status === 'draft') onOrder.set(l.product_uuid, (onOrder.get(l.product_uuid) ?? 0) + num(l.qty));
      if (p.status === 'posted') {
        const prev = last.get(l.product_uuid);
        if (!prev || prev.at < p.purchased_at) last.set(l.product_uuid, { supplier_uuid: p.supplier_uuid, unit_cost: l.unit_cost, at: p.purchased_at });
      }
    }
  }

  return db.products
    .filter((p) => p.track_stock && p.is_active)
    .map((p) => {
      const o = st.overrides[p.uuid];
      const lp = last.get(p.uuid);
      const supplierUuid = o?.supplier_uuid ?? lp?.supplier_uuid ?? null;
      const supplier = supplierUuid ? db.suppliers.find((s) => s.uuid === supplierUuid) : undefined;
      let lead = set.lead_days;
      let leadSrc: ReorderSuggestion['inputs']['lead_days_source'] = 'organization';
      if (supplier && st.supplierLeads[supplier.uuid] !== undefined) {
        lead = st.supplierLeads[supplier.uuid];
        leadSrc = 'supplier';
      }
      if (o?.lead_days != null) {
        lead = o.lead_days;
        leadSrc = 'product';
      }
      const target = o?.target_days ?? set.target_days;
      const u = used.get(p.uuid) ?? { consumed: 0, sold: 0 };
      const stock = num(p.stock_quantity);
      const min = num(p.min_stock_alert);
      const order = onOrder.get(p.uuid) ?? 0;
      const velocity = (u.consumed + u.sold) / set.velocity_days;
      const demand = velocity * (lead + target);
      const need = demand + min - stock - order;
      const pack = o?.pack_size ? num(o.pack_size) : 0;
      let suggested = 0;
      let packs: number | null = pack > 0 ? 0 : null;
      if (need > 0) {
        if (pack > 0) {
          packs = ceil(need / pack);
          suggested = packs * pack;
        } else suggested = ceil(need);
      }
      const cover = velocity > 0 ? (stock <= 0 ? 0 : stock / velocity) : null;
      const hasDemand = velocity > 0 || min > 0;
      const urgency: ReorderUrgency =
        stock < 0 || (stock === 0 && hasDemand) ? 'out_of_stock' : min > 0 && stock <= min ? 'below_min' : cover !== null && cover < lead + target ? 'low_cover' : 'none';
      const cost = lp ? num(lp.unit_cost) : num(p.cost_price);
      return {
        product_uuid: p.uuid,
        name: p.name,
        sku: p.sku ?? '',
        unit: p.unit,
        currency: p.currency,
        urgency,
        stock: qty(stock),
        min_stock: qty(min),
        on_order: qty(order),
        velocity_per_day: qty(velocity),
        days_of_cover: cover === null ? null : String(Math.round(cover * 10) / 10),
        suggested_qty: qty(suggested),
        pack_size: pack > 0 ? qty(pack) : null,
        packs,
        supplier: supplier ? { uuid: supplier.uuid, name: supplier.name, source: o?.supplier_uuid ? 'product' : 'last_purchase' } : null,
        unit_cost: money(cost),
        unit_cost_source: lp ? 'last_purchase' : 'cost_price',
        estimated_total: money(cost * suggested),
        last_purchased_at: lp?.at ?? null,
        inputs: {
          velocity_days: set.velocity_days,
          consumed_qty: qty(u.consumed),
          sold_qty: qty(u.sold),
          lead_days: lead,
          lead_days_source: leadSrc,
          target_days: target,
          target_days_source: o?.target_days != null ? 'product' : 'organization',
          demand_qty: qty(demand),
          raw_need: qty(need),
          formula: FORMULA,
        },
        override: overrideOut(db, o),
      } satisfies ReorderSuggestion;
    });
}

const RANK: Record<ReorderUrgency, number> = { out_of_stock: 0, below_min: 1, low_cover: 2, none: 3 };

function summarize(db: MockDb, items: ReorderSuggestion[]): ReorderSummary {
  const count = (u: ReorderUrgency) => items.filter((i) => i.urgency === u).length;
  const out = count('out_of_stock');
  const below = count('below_min');
  return {
    out_of_stock: out,
    below_min: below,
    low_cover: count('low_cover'),
    urgent: out + below,
    suggested: items.filter((i) => i.suggested_qty !== '0').length,
    drafts: db.purchases.filter((p) => p.status === 'draft').length,
  };
}

function settingsOut(db: MockDb): ReorderSettings {
  const st = reorderState(db);
  return {
    ...st.settings,
    notify_time: '09:00',
    supplier_lead_days: Object.entries(st.supplierLeads)
      .map(([supplier_uuid, lead_days]) => ({ supplier_uuid, supplier_name: db.suppliers.find((s) => s.uuid === supplier_uuid)?.name ?? '', lead_days }))
      .sort((a, b) => a.supplier_name.localeCompare(b.supplier_name, 'tr')),
    velocity_day_options: VELOCITY_OPTIONS,
  };
}

const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const invalid = (msg: string) => fail(400, 'VALIDATION_ERROR', msg);

// ═══ Suggestions ════════════════════════════════════════════════════════════

route('GET', '/v1/tenant/stock-reorder/suggestions', (ctx) => {
  requireRead(ctx);
  const db = getDb();
  const q = ctx.query;
  const urgency = str(q.urgency);
  if (urgency && !['out_of_stock', 'below_min', 'low_cover'].includes(urgency)) invalid('urgency must be out_of_stock, below_min or low_cover');
  const all = compute(db);
  const search = str(q.q).toLocaleLowerCase('tr-TR');
  const supplier = str(q.supplier_uuid);
  const items = all
    .filter((i) => q.all === 'true' || i.suggested_qty !== '0' || i.urgency !== 'none')
    .filter((i) => !urgency || i.urgency === urgency)
    .filter((i) => !supplier || (supplier === 'none' ? !i.supplier : i.supplier?.uuid === supplier))
    .filter((i) => !search || i.name.toLocaleLowerCase('tr-TR').includes(search) || i.sku.toLocaleLowerCase('tr-TR').includes(search))
    .sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || num(a.days_of_cover ?? 1e12) - num(b.days_of_cover ?? 1e12) || a.name.localeCompare(b.name, 'tr'));
  return { items, total: items.length, summary: summarize(db, all), settings: settingsOut(db), generated_at: now() };
});

route('GET', '/v1/tenant/stock-reorder/summary', (ctx) => {
  requireRead(ctx);
  const db = getDb();
  return summarize(db, compute(db));
});

route('GET', '/v1/tenant/stock-reorder/settings', (ctx) => {
  requireRead(ctx);
  return settingsOut(getDb());
});

route('PUT', '/v1/tenant/stock-reorder/settings', (ctx) => {
  requireWrite(ctx);
  const db = getDb();
  const b = ctx.body;
  if (!VELOCITY_OPTIONS.includes(b.velocity_days as number)) invalid('velocity_days must be one of 7, 14, 30, 60, 90');
  if (!intIn(b.lead_days, 0, 180)) invalid('lead_days must be between 0 and 180');
  if (!intIn(b.target_days, 1, 365)) invalid('target_days must be between 1 and 365');
  const st = reorderState(db);
  if (Array.isArray(b.supplier_lead_days)) {
    const next: Record<string, number> = {};
    for (const row of b.supplier_lead_days as { supplier_uuid: string; lead_days: number }[]) {
      if (!intIn(row.lead_days, 0, 180)) invalid('supplier lead_days must be between 0 and 180');
      if (!db.suppliers.some((s) => s.uuid === row.supplier_uuid)) notFound('Supplier');
      next[row.supplier_uuid] = row.lead_days;
    }
    st.supplierLeads = next;
  }
  st.settings = { velocity_days: b.velocity_days as number, lead_days: b.lead_days as number, target_days: b.target_days as number, notify_enabled: Boolean(b.notify_enabled) };
  return settingsOut(db);
});

function productOf(db: MockDb, uuid_: string) {
  const p = db.products.find((x) => x.uuid === uuid_);
  if (!p) notFound('Product');
  return p!;
}

route('GET', '/v1/tenant/stock-reorder/products/:uuid', (ctx) => {
  requireRead(ctx);
  const db = getDb();
  const p = productOf(db, ctx.params.uuid);
  return { product_uuid: p.uuid, override: overrideOut(db, reorderState(db).overrides[p.uuid]) };
});

route('PUT', '/v1/tenant/stock-reorder/products/:uuid', (ctx) => {
  requireWrite(ctx);
  const db = getDb();
  const p = productOf(db, ctx.params.uuid);
  const b = ctx.body;
  const o: Override = { supplier_uuid: null, lead_days: null, target_days: null, pack_size: null };
  if (b.supplier_uuid) {
    if (!db.suppliers.some((s) => s.uuid === b.supplier_uuid)) notFound('Supplier');
    o.supplier_uuid = str(b.supplier_uuid);
  }
  if (b.lead_days != null) {
    if (!intIn(b.lead_days, 0, 180)) invalid('lead_days must be between 0 and 180');
    o.lead_days = b.lead_days as number;
  }
  if (b.target_days != null) {
    if (!intIn(b.target_days, 1, 365)) invalid('target_days must be between 1 and 365');
    o.target_days = b.target_days as number;
  }
  if (b.pack_size != null && str(b.pack_size) !== '') {
    if (!(num(str(b.pack_size).replace(',', '.')) > 0)) invalid('pack_size must be positive');
    o.pack_size = qty(num(str(b.pack_size).replace(',', '.')));
  }
  const st = reorderState(db);
  const empty = !o.supplier_uuid && o.lead_days === null && o.target_days === null && o.pack_size === null;
  if (empty) delete st.overrides[p.uuid];
  else st.overrides[p.uuid] = o;
  return { product_uuid: p.uuid, override: overrideOut(db, st.overrides[p.uuid]) };
});

route('DELETE', '/v1/tenant/stock-reorder/products/:uuid', (ctx) => {
  requireWrite(ctx);
  const db = getDb();
  const p = productOf(db, ctx.params.uuid);
  delete reorderState(db).overrides[p.uuid];
  return { deleted: true };
});

// ═══ Drafts ═════════════════════════════════════════════════════════════════

function draftFrom(db: MockDb, supplierUuid: string, lines: { product_uuid: string; qty: number; unit_cost: number }[], notes: string): PurchaseDetail {
  const supplier = db.suppliers.find((s) => s.uuid === supplierUuid);
  if (!supplier) notFound('Supplier');
  if (!supplier!.is_active) invalid('supplier is inactive');
  const out = lines.map((l, i) => {
    const p = productOf(db, l.product_uuid);
    return { uuid: uuid(), product_uuid: p.uuid, name: p.name, unit_cost: money(l.unit_cost), qty: qty(l.qty), line_total: money(l.unit_cost * l.qty), currency: 'TRY', sort_order: i };
  });
  const at = now();
  return {
    uuid: uuid(),
    supplier_uuid: supplier!.uuid,
    supplier_name: supplier!.name,
    status: 'draft',
    currency: 'TRY',
    total_amount: money(out.reduce((s, l) => s + num(l.line_total), 0)),
    method: 'cash',
    // Omitted like the Go JSON (`omitempty`) until the draft is posted.
    notes,
    purchased_at: at,
    created_at: at,
    lines: out,
  };
}

route('POST', '/v1/tenant/stock-reorder/drafts', (ctx) => {
  requireWrite(ctx);
  const db = getDb();
  const items = Array.isArray(ctx.body.items) ? (ctx.body.items as { product_uuid: string; qty: string; supplier_uuid?: string | null; unit_cost?: string | null }[]) : [];
  if (!items.length) invalid('select at least one product');
  const sugs = new Map(compute(db).map((s) => [s.product_uuid, s]));
  const groups = new Map<string, { product_uuid: string; qty: number; unit_cost: number }[]>();
  for (const it of items) {
    const s = sugs.get(it.product_uuid);
    if (!s) {
      productOf(db, it.product_uuid);
      invalid('product does not track stock or is inactive');
    }
    const n = num(String(it.qty).replace(',', '.'));
    if (!(n > 0)) invalid(`qty of "${s!.name}" must be positive`);
    const supplier = it.supplier_uuid || s!.supplier?.uuid;
    if (!supplier) invalid(`choose a supplier for "${s!.name}"`);
    const cost = it.unit_cost != null && it.unit_cost !== '' ? num(it.unit_cost) : num(s!.unit_cost);
    groups.set(supplier!, [...(groups.get(supplier!) ?? []), { product_uuid: it.product_uuid, qty: n, unit_cost: cost }]);
  }
  const drafts = [...groups.entries()].map(([sup, lines]) => draftFrom(db, sup, lines, str(ctx.body.notes)));
  db.purchases.push(...drafts);
  return { drafts };
});

route('POST', '/v1/tenant/purchases/drafts', (ctx) => {
  requireOwner(ctx, 'tenant.purchases.write');
  const db = getDb();
  const lines = Array.isArray(ctx.body.lines) ? (ctx.body.lines as { product_uuid: string; qty?: string; unit_cost?: string }[]) : [];
  if (!lines.length) invalid('at least one product line is required');
  const draft = draftFrom(
    db,
    str(ctx.body.supplier_uuid),
    lines.map((l) => ({ product_uuid: l.product_uuid, qty: num(l.qty ?? 1), unit_cost: l.unit_cost ? num(l.unit_cost) : num(productOf(db, l.product_uuid).cost_price) })),
    str(ctx.body.notes),
  );
  db.purchases.push(draft);
  return draft;
});

function draftOf(db: MockDb, id: string) {
  const p = db.purchases.find((x) => x.uuid === id);
  if (!p) notFound('Purchase');
  if (p!.status !== 'draft') fail(409, 'CONFLICT', 'purchase is not a draft');
  return p!;
}

route('POST', '/v1/tenant/purchases/:uuid/post', (ctx) => {
  requireOwner(ctx, 'tenant.purchases.write');
  const db = getDb();
  const p = draftOf(db, ctx.params.uuid);
  const b = ctx.body;
  if (!['cash', 'card'].includes(str(b.method))) invalid('method must be cash or card');
  if (!b.finance_account_uuid) invalid('finance_account_uuid is required');
  const account = financeAccount(db, str(b.finance_account_uuid));
  if (Array.isArray(b.lines) && b.lines.length) {
    const next = draftFrom(
      db,
      p.supplier_uuid,
      (b.lines as { product_uuid: string; qty?: string; unit_cost?: string }[]).map((l) => ({ product_uuid: l.product_uuid, qty: num(l.qty ?? 1), unit_cost: num(l.unit_cost ?? 0) })),
      p.notes,
    );
    if (next.lines.some((l) => !(num(l.qty) > 0))) invalid('qty must be positive');
    p.lines = next.lines;
    p.total_amount = next.total_amount;
  }
  const total = num(p.total_amount);
  if (!(total > 0)) invalid('total must be positive');
  const at = str(b.purchased_at) || now();
  p.status = 'posted';
  p.method = str(b.method) as PurchaseDetail['method'];
  p.finance_account_uuid = account.uuid;
  p.finance_account_name = account.name;
  if (typeof b.notes === 'string') p.notes = b.notes;
  p.purchased_at = at;
  p.finance_transaction_uuid = postFinance(db, {
    type: 'expense',
    accountUuid: account.uuid,
    categoryUuid: categoryByName(db, FIN_CAT.stockPurchase, 'expense').uuid,
    amount: total,
    date: istanbulDay(at),
    description: `Stok alımı · ${p.supplier_name}`,
    paymentMethod: p.method,
    sourceType: 'purchase',
    sourceUuid: p.uuid,
  }).uuid;
  for (const l of p.lines) moveStock(db, l.product_uuid, num(l.qty));
  return p;
});

route('DELETE', '/v1/tenant/purchases/:uuid', (ctx) => {
  requireOwner(ctx, 'tenant.purchases.write');
  const db = getDb();
  const p = draftOf(db, ctx.params.uuid);
  db.purchases = db.purchases.filter((x) => x !== p);
  return { deleted: true };
});
