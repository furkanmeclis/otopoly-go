/**
 * Calendar (`/v1/tenant/calendar/*`, backend `modules/calendar`): own events plus read-only layers built from
 * the module records (jobs opened / delivered, todos, quote expiries, lead follow-ups, daily finance totals,
 * sales, purchases, signed contracts). Same layer access rules (read permission + plan module), the same
 * movable layers (events / todos / leads) and the same validation as the Go use case. Days are bucketed in
 * Europe/Istanbul. Events live in this module per organization and are seeded around today.
 */
import type { components } from '@/api/generated/api';

import { fail, istanbulDay, money, notFound, now, requirePerm, route, str, uuid, type MockCtx } from '../core';
import { getDb } from '../db';
import { planFeatureEnabled } from './billing';
import { orgStore } from './contracts';
import { leadEvent, refreshLead, todoView } from './crm';

type Schemas = components['schemas'];
type CalendarEvent = Schemas['CalendarEvent'];
type FeedItem = Schemas['CalendarFeedItem'];
type Layer = Schemas['CalendarLayer'];
type Color = Schemas['CalendarColor'];

const TZ = 'Europe/Istanbul';
const MAX_RANGE_DAYS = 62;
const COLORS: Color[] = ['blue', 'emerald', 'amber', 'rose', 'violet', 'sky', 'orange', 'teal', 'pink', 'slate'];
const LAYERS: Layer[] = ['events', 'jobs', 'deliveries', 'todos', 'quotes', 'leads', 'finance', 'sales', 'purchases', 'contracts'];

type Access = { read: string; write?: string; feature?: string; refKind?: FeedItem['ref_kind'] };
const ACCESS: Record<Layer, Access> = {
  events: { read: 'tenant.calendar.read', write: 'tenant.calendar.write', refKind: 'event' },
  jobs: { read: 'tenant.jobs.read', refKind: 'job' },
  deliveries: { read: 'tenant.jobs.read', refKind: 'job' },
  todos: { read: 'tenant.todos.read', write: 'tenant.todos.write', refKind: 'todo' },
  quotes: { read: 'tenant.quotes.read', feature: 'module.quotes', refKind: 'quote' },
  leads: { read: 'tenant.leads.read', write: 'tenant.leads.write', feature: 'module.quotes', refKind: 'lead' },
  finance: { read: 'tenant.finance.read' },
  sales: { read: 'tenant.sales.read', refKind: 'sale' },
  purchases: { read: 'tenant.purchases.read', refKind: 'purchase' },
  contracts: { read: 'tenant.contracts.read', feature: 'module.contracts', refKind: 'contract' },
};

const invalid = (message: string): never => fail(400, 'VALIDATION_ERROR', message, [{ message }]);

// ─── Time (Europe/Istanbul is UTC+3 all year) ─────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const midnight = (day: string) => new Date(`${day}T00:00:00+03:00`);
const addDays = (day: string, n: number) => istanbulDay(new Date(midnight(day).getTime() + n * 86400000 + 3600000));
const at = (day: string, hh: number, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`);
const parseDay = (v: unknown, field: string) => {
  const s = str(v).trim();
  if (!DAY_RE.test(s) || Number.isNaN(midnight(s).getTime())) invalid(`${field} must be YYYY-MM-DD`);
  return s;
};
const parseTs = (v: unknown, field: string) => {
  const d = new Date(str(v));
  if (!str(v) || Number.isNaN(d.getTime())) invalid(`invalid ${field}`);
  return d;
};

// ─── Events ──────────────────────────────────────────────────────────────────

type EventRow = CalendarEvent & { _org: string };
const events: EventRow[] = [];
const seeded = new Set<string>();

function toEvent(row: EventRow): CalendarEvent {
  const { _org: _o, ...e } = row;
  if (!e.all_day) {
    delete e.start_date;
    delete e.end_date;
  }
  return e;
}

function setTimes(row: CalendarEvent, f: Fields) {
  row.all_day = f.allDay;
  row.starts_at = f.start.toISOString();
  row.ends_at = f.end.toISOString();
  if (f.allDay) {
    row.start_date = istanbulDay(f.start);
    row.end_date = istanbulDay(new Date(f.end.getTime() - 86400000));
  } else {
    delete row.start_date;
    delete row.end_date;
  }
}

type Fields = { title: string; description: string; location: string; color: Color; allDay: boolean; start: Date; end: Date };

/** Same rules as `usecase.parseEvent`. */
function parseEvent(b: Record<string, unknown>): Fields {
  const title = str(b.title).trim();
  const location = str(b.location).trim();
  if (!title) invalid('title is required');
  if ([...title].length > 200 || [...location].length > 200) invalid('title and location are limited to 200 characters');
  const color = (str(b.color).trim() || 'blue') as Color;
  if (!COLORS.includes(color)) invalid('invalid color');
  const allDay = b.all_day === true;
  if (allDay) {
    if (!str(b.start_date)) invalid('start_date is required for all-day events');
    const startDay = parseDay(b.start_date, 'start_date');
    const lastDay = str(b.end_date) ? parseDay(b.end_date, 'end_date') : startDay;
    if (lastDay < startDay) invalid('end_date is before start_date');
    return { title, description: str(b.description).trim(), location, color, allDay, start: midnight(startDay), end: midnight(addDays(lastDay, 1)) };
  }
  if (!b.starts_at || !b.ends_at) invalid('starts_at and ends_at are required');
  const start = parseTs(b.starts_at, 'starts_at');
  const end = parseTs(b.ends_at, 'ends_at');
  if (end <= start) invalid('ends_at must be after starts_at');
  if (end.getTime() - start.getTime() > 31 * 86400000) invalid('an event can last at most 31 days');
  return { title, description: str(b.description).trim(), location, color, allDay, start, end };
}

function addEvent(org: string, f: Fields): EventRow {
  const ts = now();
  const row = { uuid: uuid(), title: f.title, description: f.description, location: f.location, color: f.color, created_at: ts, updated_at: ts, _org: org } as EventRow;
  setTimes(row, f);
  events.push(row);
  return row;
}

/** A realistic week around today: meetings, a campaign, training, a fair, admin chores. */
function seedEvents(org: string) {
  if (seeded.has(org)) return;
  seeded.add(org);
  const today = istanbulDay();
  const timed = (d: number, hh: number, mm: number, minutes: number, title: string, color: Color, location = '', description = '') => {
    const start = at(addDays(today, d), hh, mm);
    addEvent(org, { title, description, location, color, allDay: false, start, end: new Date(start.getTime() + minutes * 60000) });
  };
  const allDay = (d: number, days: number, title: string, color: Color, location = '', description = '') =>
    addEvent(org, { title, description, location, color, allDay: true, start: midnight(addDays(today, d)), end: midnight(addDays(today, d + days)) });

  allDay(-2, 7, 'Kış bakımı kampanyası', 'orange', '', 'Seramik + iç temizlik paketinde %15 indirim.');
  timed(0, 10, 0, 60, 'Tedarikçi toplantısı — Koch Chemie', 'violet', 'Ofis', 'Yeni dönem fiyat listesi ve stok planı.');
  timed(0, 17, 30, 30, 'Gün sonu kasa kontrolü', 'slate');
  timed(1, 14, 0, 90, 'Seramik kaplama eğitimi', 'teal', 'Atölye', 'Yeni personel için uygulama eğitimi.');
  timed(3, 9, 30, 45, 'Muhasebeci ile görüşme', 'sky', 'Online', 'KDV beyannamesi ve ay sonu kapanış.');
  timed(-4, 16, 0, 60, 'Stok sayımı', 'amber', 'Depo');
  allDay(6, 2, 'Autoshow İstanbul fuarı', 'blue', 'İstanbul Fuar Merkezi');
  timed(9, 11, 0, 30, 'İşyeri sigortası yenileme', 'rose', '', 'Poliçe 15 gün içinde bitiyor.');
  timed(-9, 13, 0, 60, 'Personel toplantısı', 'emerald', 'Ofis');
  timed(14, 10, 0, 120, 'Kabin bakımı (servis firması)', 'pink', 'Boya kabini');
}

function findEvent(ctx: MockCtx, id = ctx.params.uuid) {
  seedEvents(ctx.orgUuid!);
  return events.find((e) => e._org === ctx.orgUuid && e.uuid === id) ?? notFound('Event');
}

// ─── Layers ──────────────────────────────────────────────────────────────────

function available(ctx: MockCtx) {
  return LAYERS.filter((l) => {
    const a = ACCESS[l];
    return ctx.permissions.has(a.read) && (!a.feature || planFeatureEnabled(a.feature));
  }).map((key) => ({ key, movable: Boolean(ACCESS[key].write && ctx.permissions.has(ACCESS[key].write!)) }));
}

type Range = { from: string; to: string; tsMin: number; tsMax: number };
const inTs = (iso: string | null | undefined, r: Range) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.tsMin && t < r.tsMax;
};
const inDays = (day: string | null | undefined, r: Range) => Boolean(day) && day! >= r.from && day! < r.to;
const plus = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

function dayItem(id: string, layer: Layer, kind: FeedItem['kind'], title: string, day: string): FeedItem {
  return { id, layer, kind, title, all_day: true, starts_at: midnight(day).toISOString(), ends_at: midnight(addDays(day, 1)).toISOString(), start_date: day, end_date: day, movable: false };
}

function eventItem(e: CalendarEvent): FeedItem {
  return {
    id: `events:${e.uuid}`,
    layer: 'events',
    kind: 'event',
    title: e.title,
    ...(e.location ? { subtitle: e.location } : {}),
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    all_day: e.all_day,
    ...(e.all_day ? { start_date: e.start_date, end_date: e.end_date } : {}),
    ref_uuid: e.uuid,
    movable: false,
    event: e,
  };
}

function todoItem(t: { uuid: string; title: string; due_date: string | null; due_time: string | null; status: string; customer: { label: string } | null }): FeedItem {
  const item = dayItem(`todos:${t.uuid}`, 'todos', 'todo', t.title, t.due_date!);
  if (t.due_time) {
    const start = new Date(`${t.due_date}T${t.due_time}:00+03:00`);
    Object.assign(item, { all_day: false, starts_at: start.toISOString(), ends_at: plus(start.toISOString(), 30) });
    delete item.start_date;
    delete item.end_date;
  }
  if (t.customer?.label) item.subtitle = t.customer.label;
  item.status = t.status;
  item.ref_uuid = t.uuid;
  return item;
}

function leadItem(l: { uuid: string; customer_name: string; follow_up_date: string | null; interest: string; temperature: string }): FeedItem {
  const item = dayItem(`leads:${l.uuid}`, 'leads', 'lead_follow_up', l.customer_name, l.follow_up_date!);
  if (l.interest) item.subtitle = l.interest;
  item.status = l.temperature;
  item.ref_uuid = l.uuid;
  return item;
}

const join = (...parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(' · ');

function loadLayer(ctx: MockCtx, layer: Layer, r: Range): FeedItem[] {
  const db = getDb();
  switch (layer) {
    case 'events':
      seedEvents(ctx.orgUuid!);
      return events
        .filter((e) => e._org === ctx.orgUuid && new Date(e.starts_at).getTime() < r.tsMax && new Date(e.ends_at).getTime() > r.tsMin)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((e) => eventItem(toEvent(e)));
    case 'jobs':
      return db.jobs
        .filter((j) => j._org === ctx.orgUuid && (j.status as string) !== 'voided' && inTs(j.started_at, r))
        .map((j) => ({
          id: `jobs:${j.uuid}`,
          layer,
          kind: 'job_opened',
          title: j.plate,
          ...(join(j.customer_name, j.vehicle_label) ? { subtitle: join(j.customer_name, j.vehicle_label) } : {}),
          starts_at: j.started_at,
          ends_at: plus(j.started_at, 60),
          all_day: false,
          status: j.status,
          amount: j.total_amount,
          currency: j.currency ?? 'TRY',
          ref_uuid: j.uuid,
          movable: false,
        }));
    case 'deliveries':
      return db.jobs
        .filter((j) => j._org === ctx.orgUuid && !['voided', 'cancelled'].includes(j.status) && inTs(j.delivered_at, r))
        .map((j) => ({
          id: `deliveries:${j.uuid}`,
          layer,
          kind: 'job_delivered',
          title: j.plate,
          ...(join(j.customer_name, j.vehicle_label) ? { subtitle: join(j.customer_name, j.vehicle_label) } : {}),
          starts_at: j.delivered_at!,
          ends_at: plus(j.delivered_at!, 30),
          all_day: false,
          status: j.payment_status,
          amount: j.total_amount,
          currency: j.currency ?? 'TRY',
          ref_uuid: j.uuid,
          movable: false,
        }));
    case 'todos':
      return db.todos.filter((t) => inDays(t.due_date, r)).map(todoItem);
    case 'quotes':
      return db.quotes
        .filter((q) => inDays(q.valid_until, r) && ['draft', 'sent', 'viewed'].includes(q.status))
        .map((q) => {
          const item = dayItem(`quotes:${q.uuid}`, layer, 'quote_expiry', q.number, q.valid_until!);
          return { ...item, ...(q.customer_name ? { subtitle: q.customer_name } : {}), status: q.status, amount: q.grand_total, currency: q.currency, ref_uuid: q.uuid };
        });
    case 'leads':
      return db.leads.filter((l) => inDays(l.follow_up_date, r) && ['new', 'contacted', 'quoted'].includes(l.status)).map(leadItem);
    case 'finance': {
      const buckets = new Map<string, { day: string; type: 'income' | 'expense'; currency: string; total: number; count: number }>();
      for (const tx of db.transactions) {
        if (tx.status !== 'posted' || (tx.type !== 'income' && tx.type !== 'expense')) continue;
        const day = tx.transaction_date.slice(0, 10);
        if (!inDays(day, r)) continue;
        const key = `${day}:${tx.type}:${tx.currency}`;
        const b = buckets.get(key) ?? { day, type: tx.type, currency: tx.currency, total: 0, count: 0 };
        b.total += Number(tx.amount) || 0;
        b.count++;
        buckets.set(key, b);
      }
      return [...buckets.values()]
        .sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type))
        .map((b) => ({ ...dayItem(`finance:${b.day}:${b.type}:${b.currency}`, layer, b.type === 'income' ? 'finance_income' : 'finance_expense', '', b.day), amount: money(b.total), currency: b.currency, count: b.count }));
    }
    case 'sales':
      return db.sales
        .filter((s) => s.status === 'posted' && inTs(s.sold_at, r))
        .map((s) => ({
          id: `sales:${s.uuid}`,
          layer,
          kind: 'sale',
          title: s.customer_name,
          starts_at: s.sold_at,
          ends_at: plus(s.sold_at, 30),
          all_day: false,
          status: s.method,
          amount: s.total_amount,
          currency: s.currency,
          ref_uuid: s.uuid,
          movable: false,
        }));
    case 'purchases':
      return db.purchases
        .filter((p) => p.status === 'posted' && inTs(p.purchased_at, r))
        .map((p) => ({
          id: `purchases:${p.uuid}`,
          layer,
          kind: 'purchase',
          title: p.supplier_name,
          starts_at: p.purchased_at,
          ends_at: plus(p.purchased_at, 30),
          all_day: false,
          status: p.method,
          amount: p.total_amount,
          currency: p.currency,
          ref_uuid: p.uuid,
          movable: false,
        }));
    case 'contracts':
      return orgStore(ctx)
        .s.instances.filter((i) => i._org === ctx.orgUuid && i.status === 'executed' && inTs(i.executed_at, r))
        .map((i) => ({
          id: `contracts:${i.uuid}`,
          layer,
          kind: 'contract_executed',
          title: i.title,
          subtitle: `#${i.number}`,
          starts_at: i.executed_at!,
          ends_at: plus(i.executed_at!, 30),
          all_day: false,
          status: i.status,
          ref_uuid: i.uuid,
          movable: false,
        }));
  }
  return [];
}

// ─── Routes ──────────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/calendar/meta', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.read');
  return { layers: available(ctx), colors: COLORS, timezone: TZ, max_range_days: MAX_RANGE_DAYS };
});

route('GET', '/v1/tenant/calendar/feed', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.read');
  const raw = str(ctx.query.layers).trim();
  const wanted: Layer[] = [];
  for (const l of raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : LAYERS) {
    if (!LAYERS.includes(l as Layer)) invalid(`unknown layer "${l}"`);
    if (!wanted.includes(l as Layer)) wanted.push(l as Layer);
  }
  if (!DAY_RE.test(str(ctx.query.from))) invalid('from must be YYYY-MM-DD');
  if (!DAY_RE.test(str(ctx.query.to))) invalid('to must be YYYY-MM-DD');
  const from = ctx.query.from;
  const to = ctx.query.to;
  if (to <= from) invalid('to must be after from');
  if (Math.round((midnight(to).getTime() - midnight(from).getTime()) / 86400000) > MAX_RANGE_DAYS) invalid(`range is limited to ${MAX_RANGE_DAYS} days`);
  const layers = available(ctx);
  const movable = new Map(layers.map((l) => [l.key, l.movable]));
  const r: Range = { from, to, tsMin: midnight(from).getTime(), tsMax: midnight(to).getTime() };
  const items: FeedItem[] = [];
  const counts: Record<string, number> = {};
  for (const layer of wanted) {
    if (!movable.has(layer)) continue;
    const rows = loadLayer(ctx, layer, r);
    counts[layer] = rows.length;
    for (const it of rows) {
      const refKind = ACCESS[layer].refKind;
      items.push({ ...it, ...(refKind ? { ref_kind: refKind } : {}), movable: movable.get(layer)! });
    }
  }
  return { from, to, timezone: TZ, layers, items, counts };
});

route('POST', '/v1/tenant/calendar/items/move', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.read');
  const b = ctx.body;
  const layer = str(b.layer) as Layer;
  const ref = str(b.ref_uuid);
  if (!ref) invalid('ref_uuid is required');
  if (!LAYERS.includes(layer)) invalid(`unknown layer "${layer}"`);
  if (!available(ctx).find((l) => l.key === layer)?.movable) fail(403, 'FORBIDDEN', `items of layer "${layer}" cannot be moved`);
  const allDay = b.all_day === true;
  // Same as usecase.placement: a date (all-day / date-only layers) or a date + HH:MM (timed todos).
  const placement = (withTime: boolean) => {
    if ((allDay || !withTime) && str(b.start_date).trim()) return { day: parseDay(b.start_date, 'start_date'), clock: '' };
    if (allDay) invalid('start_date is required for all-day placement');
    if (!b.starts_at) invalid('starts_at is required');
    const d = parseTs(b.starts_at, 'starts_at');
    const local = new Date(d.getTime() + 3 * 3600000).toISOString();
    return { day: local.slice(0, 10), clock: withTime ? local.slice(11, 16) : '' };
  };
  const db = getDb();
  let item: FeedItem;
  if (layer === 'events') {
    const row = findEvent(ctx, ref);
    const f = parseEvent({ ...row, all_day: allDay, starts_at: b.starts_at, ends_at: b.ends_at, start_date: b.start_date, end_date: b.end_date });
    setTimes(row, f);
    row.updated_at = now();
    item = eventItem(toEvent(row));
  } else if (layer === 'todos') {
    const t = db.todos.find((x) => x.uuid === ref) ?? notFound('Todo');
    const { day, clock } = placement(true);
    t.due_date = day;
    t.due_time = clock || null;
    t.updated_at = now();
    todoView(t);
    item = todoItem(t);
  } else {
    const l = db.leads.find((x) => x.uuid === ref) ?? notFound('Lead');
    const { day } = placement(false);
    const before = l.follow_up_date ?? '';
    l.follow_up_date = day;
    leadEvent(ctx, l, { kind: 'follow_up_changed', from_value: before, to_value: day });
    refreshLead(l);
    item = leadItem(l);
  }
  return { ...item, ref_kind: ACCESS[layer].refKind, movable: true };
});

route('POST', '/v1/tenant/calendar/events', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.write');
  seedEvents(ctx.orgUuid!);
  return toEvent(addEvent(ctx.orgUuid!, parseEvent(ctx.body)));
});

route('GET', '/v1/tenant/calendar/events/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.read');
  return toEvent(findEvent(ctx));
});

route('PUT', '/v1/tenant/calendar/events/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.write');
  const row = findEvent(ctx);
  const f = parseEvent(ctx.body);
  Object.assign(row, { title: f.title, description: f.description, location: f.location, color: f.color, updated_at: now() });
  setTimes(row, f);
  return toEvent(row);
});

route('DELETE', '/v1/tenant/calendar/events/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.calendar.write');
  const row = findEvent(ctx);
  events.splice(events.indexOf(row), 1);
  return { deleted: true };
});
