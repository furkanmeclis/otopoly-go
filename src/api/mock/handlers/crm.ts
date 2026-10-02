/** Leads, quotes and todos. */
import type { LeadDetail, LeadEvent } from '@/features/leads/types';
import type { QuoteDetail, QuoteLine, QuoteStatus } from '@/features/quotes/types';
import type { Todo } from '@/features/todos/types';

import {
  fail,
  istanbulDay,
  matchRoute,
  money,
  notFound,
  now,
  num,
  paginate,
  requireFields,
  requirePerm,
  route,
  search,
  sortBy,
  str,
  uuid,
  type MockCtx,
} from '../core';
import { getDb, type MockDb } from '../db';

const actorName = (ctx: MockCtx) => (ctx.user ? `${ctx.user.name} ${ctx.user.surname}` : 'Sistem');

function userRef(db: MockDb, userUuid: string | null | undefined) {
  const u = db.users.find((x) => x.uuid === userUuid);
  return u ? { uuid: u.uuid, label: `${u.name} ${u.surname}` } : null;
}

function followState(date: string | null | undefined): LeadDetail['follow_up_state'] {
  if (!date) return 'none';
  const today = istanbulDay();
  return date < today ? 'overdue' : date === today ? 'today' : 'upcoming';
}

// ═══ Leads ══════════════════════════════════════════════════════════════════

function leadEvent(ctx: MockCtx, lead: LeadDetail, e: Partial<LeadEvent> & { kind: string }) {
  const at = now();
  lead.events.unshift({
    uuid: uuid(),
    from_value: '',
    to_value: '',
    body: '',
    ref_type: '',
    ref_uuid: null,
    ref_label: '',
    actor_name: actorName(ctx),
    created_at: at,
    ...e,
  });
  lead.last_activity_at = at;
  lead.updated_at = at;
}

function refreshLead(lead: LeadDetail) {
  lead.follow_up_state = lead.status === 'won' || lead.status === 'lost' ? 'none' : followState(lead.follow_up_date);
  const db = getDb();
  lead.quotes = db.quotes
    .filter((q) => q.lead_uuid === lead.uuid)
    .map((q) => ({ uuid: q.uuid, number: q.number, status: q.status, grand_total: q.grand_total, currency: q.currency, valid_until: q.valid_until, created_at: q.created_at }));
  lead.quote_count = lead.quotes.length;
  return lead;
}

function leadListItem(lead: LeadDetail) {
  const { vehicle_uuid: _v, notes: _n, created_by_name: _c, contacted_at: _ca, closed_at: _cl, quotes: _q, events: _e, ...rest } = refreshLead(lead);
  return rest;
}

function findLead(ctx: MockCtx, id = ctx.params.uuid) {
  const lead = getDb().leads.find((l) => l.uuid === id);
  if (!lead) notFound('Lead');
  return lead!;
}

route('GET', '/v1/tenant/leads/summary', (ctx) => {
  requirePerm(ctx, 'tenant.leads.read');
  const leads = getDb().leads.map(refreshLead);
  const open = leads.filter((l) => l.status !== 'won' && l.status !== 'lost');
  return {
    open: open.length,
    new: open.filter((l) => l.status === 'new').length,
    hot: open.filter((l) => l.temperature === 'hot').length,
    overdue: open.filter((l) => l.follow_up_state === 'overdue').length,
    due_today: open.filter((l) => l.follow_up_state === 'today').length,
    mine: open.filter((l) => l.assignee?.uuid === ctx.user?.uuid).length,
    date: istanbulDay(),
  };
});

route('GET', '/v1/tenant/leads/assignees', (ctx) => {
  requirePerm(ctx, 'tenant.leads.read');
  const db = getDb();
  return db.memberships
    .filter((m) => m.orgUuid === ctx.orgUuid)
    .map((m) => ({ m, u: db.users.find((u) => u.uuid === m.userUuid)! }))
    .filter(({ u }) => u.status === 'active')
    .map(({ m, u }) => ({ uuid: u.uuid, label: `${u.name} ${u.surname}`, role: m.role }));
});

route('GET', '/v1/tenant/leads', (ctx) => {
  requirePerm(ctx, 'tenant.leads.read');
  const q = ctx.query;
  let items = getDb().leads.map(refreshLead);
  // Backend: `status=open` means new/contacted/quoted (leads.sql).
  const leadStatuses = q.status === 'open' ? ['new', 'contacted', 'quoted'] : q.status ? q.status.split(',') : null;
  if (leadStatuses) items = items.filter((l) => leadStatuses.includes(l.status));
  if (q.temperature) items = items.filter((l) => l.temperature === q.temperature);
  if (q.source) items = items.filter((l) => l.source === q.source);
  if (q.assignee === 'me') items = items.filter((l) => l.assignee?.uuid === ctx.user?.uuid);
  else if (q.assignee) items = items.filter((l) => l.assignee?.uuid === q.assignee);
  if (q.follow_up) items = items.filter((l) => l.follow_up_state === q.follow_up);
  if (q.customer_uuid) items = items.filter((l) => l.customer_uuid === q.customer_uuid);
  items = search(items, q.q, ['customer_name', 'customer_phone', 'vehicle_plate', 'interest']);
  let sorted = sortBy(items, q.sort, '-last_activity_at');
  // Backend orders undated follow-ups last.
  if (q.sort === 'follow_up_date') sorted = [...sorted.filter((l) => l.follow_up_date), ...sorted.filter((l) => !l.follow_up_date)];
  const page = paginate(sorted, q, 50);
  return { ...page, items: page.items.map(leadListItem) };
});

route('POST', '/v1/tenant/leads', (ctx) => {
  requirePerm(ctx, 'tenant.leads.write');
  requireFields(ctx.body, ['customer_uuid']);
  const db = getDb();
  const b = ctx.body;
  const customer = db.customers.find((c) => c.uuid === b.customer_uuid);
  if (!customer) notFound('Customer');
  const vehicle = b.vehicle_uuid ? db.vehicles.find((v) => v.uuid === b.vehicle_uuid) : null;
  const at = now();
  const lead: LeadDetail = {
    uuid: uuid(),
    customer_uuid: customer!.uuid,
    customer_name: customer!.name,
    customer_phone: customer!.phone,
    vehicle_plate: vehicle?.plate ?? '',
    vehicle_text: str(b.vehicle_text) || (vehicle ? `${vehicle.brand_name} ${vehicle.model_name}` : ''),
    interest: str(b.interest),
    source: (str(b.source) || 'other') as LeadDetail['source'],
    temperature: (str(b.temperature) || 'warm') as LeadDetail['temperature'],
    status: 'new',
    lost_reason: '',
    follow_up_date: (b.follow_up_date as string) || null,
    follow_up_state: 'none',
    assignee: userRef(db, (b.assignee_uuid as string) || ctx.user?.uuid),
    quote_count: 0,
    last_activity_at: at,
    created_at: at,
    updated_at: at,
    vehicle_uuid: vehicle?.uuid ?? null,
    notes: str(b.notes),
    created_by_name: actorName(ctx),
    contacted_at: null,
    closed_at: null,
    quotes: [],
    events: [],
  };
  leadEvent(ctx, lead, { kind: 'created', to_value: 'new' });
  db.leads.push(lead);
  return refreshLead(lead);
});

route('GET', '/v1/tenant/leads/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.leads.read');
  return refreshLead(findLead(ctx));
});

route('PATCH', '/v1/tenant/leads/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.leads.write');
  const db = getDb();
  const lead = findLead(ctx);
  const b = ctx.body;
  if (b.status !== undefined && b.status !== lead.status) {
    const to = str(b.status) as LeadDetail['status'];
    if (to === 'lost' && !str(b.lost_reason ?? lead.lost_reason)) {
      fail(400, 'VALIDATION_ERROR', 'Lost reason required', [{ field: 'lost_reason', message: 'required' }]);
    }
    leadEvent(ctx, lead, { kind: 'status_changed', from_value: lead.status, to_value: to });
    lead.status = to;
    if (to === 'contacted') lead.contacted_at ??= now();
    lead.closed_at = to === 'won' || to === 'lost' ? now() : null;
  }
  if (b.lost_reason !== undefined) lead.lost_reason = str(b.lost_reason);
  if (b.temperature !== undefined && b.temperature !== lead.temperature) {
    leadEvent(ctx, lead, { kind: 'temperature_changed', from_value: lead.temperature, to_value: str(b.temperature) });
    lead.temperature = str(b.temperature) as LeadDetail['temperature'];
  }
  if (b.source !== undefined && b.source !== lead.source) {
    leadEvent(ctx, lead, { kind: 'source_changed', from_value: lead.source, to_value: str(b.source) });
    lead.source = str(b.source) as LeadDetail['source'];
  }
  if (b.follow_up_date !== undefined) {
    const next = str(b.follow_up_date) || null;
    if (next !== lead.follow_up_date) leadEvent(ctx, lead, { kind: 'follow_up_changed', from_value: lead.follow_up_date ?? '', to_value: next ?? '' });
    lead.follow_up_date = next;
  }
  if (b.assignee_uuid !== undefined) {
    const next = userRef(db, str(b.assignee_uuid) || null);
    if (next?.uuid !== lead.assignee?.uuid) leadEvent(ctx, lead, { kind: 'assignee_changed', from_value: lead.assignee?.label ?? '', to_value: next?.label ?? '' });
    lead.assignee = next;
  }
  if (b.customer_uuid !== undefined) {
    const c = db.customers.find((x) => x.uuid === b.customer_uuid);
    if (!c) notFound('Customer');
    Object.assign(lead, { customer_uuid: c!.uuid, customer_name: c!.name, customer_phone: c!.phone });
  }
  if (b.vehicle_uuid !== undefined) {
    const v = db.vehicles.find((x) => x.uuid === b.vehicle_uuid);
    lead.vehicle_uuid = v?.uuid ?? null;
    lead.vehicle_plate = v?.plate ?? '';
  }
  for (const k of ['vehicle_text', 'interest', 'notes'] as const) if (b[k] !== undefined) lead[k] = str(b[k]);
  lead.updated_at = now();
  return refreshLead(lead);
});

route('DELETE', '/v1/tenant/leads/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.leads.write');
  const db = getDb();
  const lead = findLead(ctx);
  db.leads = db.leads.filter((l) => l !== lead);
  for (const q of db.quotes) if (q.lead_uuid === lead.uuid) q.lead_uuid = null;
  return { deleted: true };
});

route('POST', '/v1/tenant/leads/:uuid/notes', (ctx) => {
  requirePerm(ctx, 'tenant.leads.write');
  const lead = findLead(ctx);
  const body = str(ctx.body.body).trim();
  if (!body) fail(400, 'VALIDATION_ERROR', 'Note is empty', [{ field: 'body', message: 'required' }]);
  leadEvent(ctx, lead, { kind: 'note', body });
  return refreshLead(lead);
});

route('POST', '/v1/tenant/leads/:uuid/todo', (ctx) => {
  requirePerm(ctx, 'tenant.leads.write');
  requirePerm(ctx, 'tenant.todos.write');
  const lead = findLead(ctx);
  const title = str(ctx.body.title).trim() || `${lead.customer_name} · takip`;
  const todo = createTodo(ctx, {
    title,
    notes: ctx.body.notes,
    due_date: ctx.body.due_date ?? lead.follow_up_date,
    due_time: ctx.body.due_time,
    assignee_uuid: ctx.body.assignee_uuid ?? lead.assignee?.uuid,
    customer_uuid: lead.customer_uuid,
    lead_uuid: lead.uuid,
  });
  leadEvent(ctx, lead, { kind: 'todo_created', ref_type: 'todo', ref_uuid: todo.uuid, ref_label: todo.title });
  return { todo_uuid: todo.uuid, title: todo.title, lead: refreshLead(lead) };
});

// ═══ Todos ══════════════════════════════════════════════════════════════════

function todoView(t: Todo): Todo {
  t.overdue = t.status === 'open' && !!t.due_date && t.due_date < istanbulDay();
  // Date-only todos are due at 09:00 Europe/Istanbul; next_reminder_at = earliest future fire time.
  if (t.status === 'open' && t.due_date && t.reminder_offsets.length) {
    const due = new Date(`${t.due_date}T${t.due_time ?? '09:00'}:00+03:00`).getTime();
    const upcoming = t.reminder_offsets.map((m) => due - m * 60000).filter((at) => at > Date.now());
    t.next_reminder_at = upcoming.length ? new Date(Math.min(...upcoming)).toISOString() : null;
  } else {
    t.next_reminder_at = null;
  }
  return t;
}

/** Shared with the assistant mock (`create_todo` confirm cards set `via_ai`). */
export function createTodo(ctx: MockCtx, b: Record<string, unknown>) {
  const db = getDb();
  const title = str(b.title).trim();
  if (!title) fail(400, 'VALIDATION_ERROR', 'Title is required', [{ field: 'title', message: 'required' }]);
  if (b.due_time && !b.due_date) fail(400, 'VALIDATION_ERROR', 'due_time requires due_date', [{ field: 'due_time', message: 'requires due_date' }]);
  const offsets = Array.isArray(b.reminder_offsets) ? (b.reminder_offsets as number[]).slice(0, 5) : [];
  if (offsets.length && !b.due_date) fail(400, 'VALIDATION_ERROR', 'Reminders require a due date', [{ field: 'reminder_offsets', message: 'requires due_date' }]);
  const customer = b.customer_uuid ? db.customers.find((c) => c.uuid === b.customer_uuid) : null;
  const job = b.job_uuid ? db.jobs.find((j) => j.uuid === b.job_uuid) : null;
  const lead = b.lead_uuid ? db.leads.find((l) => l.uuid === b.lead_uuid) : null;
  const quote = b.quote_uuid ? db.quotes.find((q) => q.uuid === b.quote_uuid) : null;
  const at = now();
  const todo: Todo = {
    uuid: uuid(),
    title,
    notes: str(b.notes),
    due_date: (b.due_date as string) || null,
    due_time: (b.due_time as string) || null,
    status: 'open',
    overdue: false,
    assignee: userRef(db, (b.assignee_uuid as string) || null),
    customer: customer ? { uuid: customer.uuid, label: customer.name } : null,
    job: job ? { uuid: job.uuid, label: job.plate } : null,
    lead: lead ? { uuid: lead.uuid, label: lead.customer_name } : null,
    quote: quote ? { uuid: quote.uuid, label: quote.number } : null,
    reminder_offsets: offsets,
    next_reminder_at: null,
    via_ai: b.via_ai === true,
    created_by_name: actorName(ctx),
    completed_at: null,
    created_at: at,
    updated_at: at,
  };
  db.todos.push(todo);
  return todoView(todo);
}

function findTodo(ctx: MockCtx) {
  const t = getDb().todos.find((x) => x.uuid === ctx.params.uuid);
  if (!t) notFound('Todo');
  return t!;
}

function todoScope(t: Todo, scope: string) {
  const today = istanbulDay();
  if (t.status !== 'open') return false;
  switch (scope) {
    case 'overdue':
      return !!t.due_date && t.due_date < today;
    case 'today':
      return t.due_date === today;
    case 'open_due':
      return !!t.due_date && t.due_date <= today;
    case 'upcoming':
      return !!t.due_date && t.due_date > today;
    case 'no_date':
      return !t.due_date;
    default:
      return true;
  }
}

route('GET', '/v1/tenant/todos/summary', (ctx) => {
  requirePerm(ctx, 'tenant.todos.read');
  const open = getDb().todos.filter((t) => t.status === 'open');
  return {
    open: open.length,
    overdue: open.filter((t) => todoScope(t, 'overdue')).length,
    today: open.filter((t) => todoScope(t, 'today')).length,
    mine: open.filter((t) => t.assignee?.uuid === ctx.user?.uuid).length,
    date: istanbulDay(),
  };
});

route('GET', '/v1/tenant/todos/assignees', (ctx) => {
  requirePerm(ctx, 'tenant.todos.read');
  const db = getDb();
  return db.memberships
    .filter((m) => m.orgUuid === ctx.orgUuid)
    .map((m) => ({ m, u: db.users.find((u) => u.uuid === m.userUuid)! }))
    .filter(({ u }) => u.status === 'active')
    .map(({ m, u }) => ({ uuid: u.uuid, name: `${u.name} ${u.surname}`, role: m.role }));
});

route('GET', '/v1/tenant/todos', (ctx) => {
  requirePerm(ctx, 'tenant.todos.read');
  const q = ctx.query;
  let items = getDb().todos.map(todoView);
  if (q.status) items = items.filter((t) => t.status === q.status);
  if (q.scope) items = items.filter((t) => todoScope(t, q.scope));
  if (q.assignee === 'me') items = items.filter((t) => t.assignee?.uuid === ctx.user?.uuid);
  else if (q.assignee) items = items.filter((t) => t.assignee?.uuid === q.assignee);
  if (q.customer) items = items.filter((t) => t.customer?.uuid === q.customer);
  if (q.lead) items = items.filter((t) => t.lead?.uuid === q.lead);
  if (q.quote) items = items.filter((t) => t.quote?.uuid === q.quote);
  items = search(items, q.q, ['title', 'notes', (t) => t.customer?.label ?? '']);
  const sorted = [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'done') return (b.completed_at ?? '').localeCompare(a.completed_at ?? '');
    const ad = a.due_date ? `${a.due_date} ${a.due_time ?? '99:99'}` : '9999';
    const bd = b.due_date ? `${b.due_date} ${b.due_time ?? '99:99'}` : '9999';
    return ad.localeCompare(bd);
  });
  return paginate(sorted, q, 50);
});

route('POST', '/v1/tenant/todos', (ctx) => {
  requirePerm(ctx, 'tenant.todos.write');
  return createTodo(ctx, ctx.body);
});

route('GET', '/v1/tenant/todos/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.todos.read');
  return todoView(findTodo(ctx));
});

route('PATCH', '/v1/tenant/todos/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.todos.write');
  const db = getDb();
  const t = findTodo(ctx);
  const b = ctx.body;
  if (b.title !== undefined) {
    if (!str(b.title).trim()) fail(400, 'VALIDATION_ERROR', 'Title is required', [{ field: 'title', message: 'required' }]);
    t.title = str(b.title).trim();
  }
  if (b.notes !== undefined) t.notes = str(b.notes);
  if (b.due_date !== undefined) t.due_date = str(b.due_date) || null;
  if (b.due_time !== undefined) t.due_time = str(b.due_time) || null;
  if (!t.due_date) t.due_time = null;
  if (b.assignee_uuid !== undefined) t.assignee = userRef(db, str(b.assignee_uuid) || null);
  if (b.customer_uuid !== undefined) {
    const c = db.customers.find((x) => x.uuid === b.customer_uuid);
    t.customer = c ? { uuid: c.uuid, label: c.name } : null;
  }
  if (b.job_uuid !== undefined) {
    const j = db.jobs.find((x) => x.uuid === b.job_uuid);
    t.job = j ? { uuid: j.uuid, label: j.plate } : null;
  }
  if (b.lead_uuid !== undefined) {
    const l = db.leads.find((x) => x.uuid === b.lead_uuid);
    t.lead = l ? { uuid: l.uuid, label: l.customer_name } : null;
  }
  if (b.quote_uuid !== undefined) {
    const q = db.quotes.find((x) => x.uuid === b.quote_uuid);
    t.quote = q ? { uuid: q.uuid, label: q.number } : null;
  }
  if (Array.isArray(b.reminder_offsets)) {
    if (b.reminder_offsets.length && !t.due_date) fail(400, 'VALIDATION_ERROR', 'Reminders require a due date', [{ field: 'reminder_offsets', message: 'requires due_date' }]);
    t.reminder_offsets = (b.reminder_offsets as number[]).slice(0, 5);
  }
  if (!t.due_date) t.reminder_offsets = [];
  t.updated_at = now();
  return todoView(t);
});

route('POST', '/v1/tenant/todos/:uuid/complete', (ctx) => {
  requirePerm(ctx, 'tenant.todos.write');
  const t = findTodo(ctx);
  t.status = 'done';
  t.completed_at = now();
  t.updated_at = now();
  return todoView(t);
});

route('POST', '/v1/tenant/todos/:uuid/reopen', (ctx) => {
  requirePerm(ctx, 'tenant.todos.write');
  const t = findTodo(ctx);
  t.status = 'open';
  t.completed_at = null;
  t.updated_at = now();
  return todoView(t);
});

route('DELETE', '/v1/tenant/todos/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.todos.write');
  const db = getDb();
  const t = findTodo(ctx);
  db.todos = db.todos.filter((x) => x !== t);
  return { deleted: true };
});

// ═══ Quotes ═════════════════════════════════════════════════════════════════

type LineInput = {
  line_type?: string;
  service_uuid?: string | null;
  product_uuid?: string | null;
  description?: string;
  quantity?: string;
  unit?: string;
  unit_price?: string | null;
  discount_type?: string;
  discount_value?: string;
  vat_rate?: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Server-side totals: line discount → quote discount pro rata → VAT incl/excl. */
export function computeQuote(
  db: MockDb,
  inputs: LineInput[],
  opts: { pricesIncludeVat: boolean; discountType: string; discountValue: number },
) {
  const lines: QuoteLine[] = inputs.map((l, i) => {
    const type = (l.line_type || (l.service_uuid ? 'service' : l.product_uuid ? 'product' : 'custom')) as QuoteLine['line_type'];
    const service = type === 'service' ? db.services.find((s) => s.uuid === l.service_uuid) : null;
    const product = type === 'product' ? db.products.find((p) => p.uuid === l.product_uuid) : null;
    if (type === 'service' && !service) fail(400, 'VALIDATION_ERROR', 'Service not found', [{ field: `lines[${i}].service_uuid`, message: 'not found' }]);
    if (type === 'product' && !product) fail(400, 'VALIDATION_ERROR', 'Product not found', [{ field: `lines[${i}].product_uuid`, message: 'not found' }]);
    const description = str(l.description).trim() || service?.name || product?.name || '';
    if (!description) fail(400, 'VALIDATION_ERROR', 'Description required', [{ field: `lines[${i}].description`, message: 'required' }]);
    const unitPrice = l.unit_price != null && l.unit_price !== '' ? num(l.unit_price) : num(service?.price ?? product?.sale_price);
    if (type === 'custom' && (l.unit_price == null || l.unit_price === '')) {
      fail(400, 'VALIDATION_ERROR', 'Price required', [{ field: `lines[${i}].unit_price`, message: 'required' }]);
    }
    const qty = num(l.quantity ?? '1') || 1;
    const vat = l.vat_rate != null && l.vat_rate !== '' ? num(l.vat_rate) : num(service?.vat_rate ?? product?.vat_rate ?? 20);
    const subtotal = r2(unitPrice * qty);
    const dType = (l.discount_type || 'none') as QuoteLine['discount_type'];
    const dValue = num(l.discount_value);
    const lineDiscount = r2(dType === 'percent' ? (subtotal * Math.min(dValue, 100)) / 100 : dType === 'amount' ? Math.min(dValue, subtotal) : 0);
    return {
      uuid: uuid(),
      line_type: type,
      ...(service ? { service_uuid: service.uuid } : {}),
      ...(product ? { product_uuid: product.uuid } : {}),
      description,
      quantity: String(qty),
      unit: str(l.unit) || product?.unit || 'piece',
      unit_price: money(unitPrice),
      discount_type: dType,
      discount_value: money(dValue),
      vat_rate: String(vat),
      line_subtotal: money(subtotal),
      line_discount: money(lineDiscount),
      quote_discount_share: '0.00',
      net_amount: '0.00',
      vat_amount: '0.00',
      line_total: '0.00',
      sort_order: i,
    } as QuoteLine;
  });

  const afterLine = lines.map((l) => num(l.line_subtotal) - num(l.line_discount));
  const base = afterLine.reduce((s, v) => s + v, 0);
  const quoteDiscount = r2(
    opts.discountType === 'percent' ? (base * Math.min(opts.discountValue, 100)) / 100 : opts.discountType === 'amount' ? Math.min(opts.discountValue, base) : 0,
  );
  let allocated = 0;
  let vatTotal = 0;
  let grand = 0;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? r2(quoteDiscount - allocated) : base > 0 ? r2((quoteDiscount * afterLine[i]) / base) : 0;
    allocated += share;
    const amount = afterLine[i] - share;
    const rate = num(l.vat_rate) / 100;
    const net = opts.pricesIncludeVat ? amount / (1 + rate) : amount;
    const vat = opts.pricesIncludeVat ? amount - net : amount * rate;
    const total = opts.pricesIncludeVat ? amount : amount + vat;
    l.quote_discount_share = money(share);
    l.net_amount = money(net);
    l.vat_amount = money(vat);
    l.line_total = money(total);
    vatTotal += r2(vat);
    grand += r2(total);
  });
  const subtotal = lines.reduce((s, l) => s + num(l.line_subtotal), 0);
  const discountTotal = lines.reduce((s, l) => s + num(l.line_discount), 0) + quoteDiscount;
  return { lines, subtotal: money(subtotal), discount_total: money(discountTotal), vat_total: money(vatTotal), grand_total: money(grand) };
}

// Manual targets from backend quotes/usecase/status.go (viewed/expired are system-only).
const TRANSITIONS: Record<string, QuoteStatus[]> = {
  draft: ['sent', 'accepted', 'rejected', 'cancelled'],
  sent: ['accepted', 'rejected', 'cancelled'],
  viewed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['cancelled'],
  rejected: [],
  expired: [],
  cancelled: [],
};

function refreshQuote(q: QuoteDetail) {
  q.is_past_valid_until = !!q.valid_until && q.valid_until < istanbulDay();
  if (q.is_past_valid_until && ['draft', 'sent', 'viewed'].includes(q.status)) {
    q.status = 'expired';
    q.expired_at ??= now();
  }
  q.allowed_statuses = q.status === 'accepted' && q.job_uuid ? [] : TRANSITIONS[q.status] ?? [];
  q.can_edit = q.status === 'draft' || q.status === 'sent' || q.status === 'viewed';
  q.can_send = ['draft', 'sent', 'viewed'].includes(q.status);
  q.can_convert = ['accepted', 'sent', 'viewed'].includes(q.status) && !q.job_uuid;
  q.line_count = q.lines.length;
  return q;
}

function quoteListItem(q: QuoteDetail) {
  const r = refreshQuote(q);
  return {
    uuid: r.uuid,
    number: r.number,
    status: r.status,
    currency: r.currency,
    grand_total: r.grand_total,
    valid_until: r.valid_until,
    is_past_valid_until: r.is_past_valid_until,
    customer_uuid: r.customer_uuid,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
    vehicle_plate: r.vehicle_plate,
    vehicle_label: r.vehicle_label,
    lead_uuid: r.lead_uuid,
    job_uuid: r.job_uuid,
    line_count: r.line_count,
    sent_at: r.sent_at,
    viewed_at: r.viewed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function quoteEvent(ctx: MockCtx | null, q: QuoteDetail, e: { kind: string; from_status?: string; to_status?: string; body?: string; channel?: 'tenant' | 'public' | 'system' }) {
  q.events.unshift({
    uuid: uuid(),
    kind: e.kind,
    from_status: e.from_status ?? '',
    to_status: e.to_status ?? '',
    body: e.body ?? '',
    channel: e.channel ?? 'tenant',
    actor_name: ctx ? actorName(ctx) : 'Sistem',
    created_at: now(),
  });
  q.updated_at = now();
}

function nextQuoteNumber(db: MockDb) {
  const year = new Date().getFullYear();
  const n = db.quotes.filter((q) => q.number.startsWith(`TKL-${year}-`)).length + 1;
  return `TKL-${year}-${String(n).padStart(4, '0')}`;
}

function findQuote(ctx: MockCtx) {
  const q = getDb().quotes.find((x) => x.uuid === ctx.params.uuid);
  if (!q) notFound('Quote');
  return q!;
}

export function saveQuote(ctx: MockCtx | null, existing: QuoteDetail | null, b: Record<string, unknown>, actor: string) {
  const db = getDb();
  if (!b.customer_uuid) fail(400, 'VALIDATION_ERROR', 'Customer is required', [{ field: 'customer_uuid', message: 'required' }]);
  const lines = Array.isArray(b.lines) ? (b.lines as LineInput[]) : [];
  if (!lines.length) fail(400, 'VALIDATION_ERROR', 'At least one line is required', [{ field: 'lines', message: 'required' }]);
  const customer = db.customers.find((c) => c.uuid === b.customer_uuid);
  if (!customer) notFound('Customer');
  const vehicleInput = (b.vehicle ?? null) as { vehicle_uuid?: string; plate?: string; label?: string; model_uuid?: string; year?: number } | null;
  const vehicle = vehicleInput?.vehicle_uuid ? db.vehicles.find((v) => v.uuid === vehicleInput.vehicle_uuid) : null;
  const model = vehicleInput?.model_uuid ? db.vehicleCatalog.find((m) => m.model_uuid === vehicleInput.model_uuid) : null;
  const pricesIncludeVat = b.prices_include_vat === undefined ? true : Boolean(b.prices_include_vat);
  const discountType = str(b.discount_type) || 'none';
  const totals = computeQuote(db, lines, { pricesIncludeVat, discountType, discountValue: num(b.discount_value) });
  const at = now();
  const q: QuoteDetail =
    existing ??
    ({
      uuid: uuid(),
      number: nextQuoteNumber(db),
      status: 'draft',
      created_at: at,
      events: [],
      deliveries: [],
      reminders: [],
      share_url: '',
      view_count: 0,
      sent_at: null,
      viewed_at: null,
      accepted_at: null,
      rejected_at: null,
      expired_at: null,
      cancelled_at: null,
      decision_note: '',
      decision_channel: '',
      converted_at: null,
      job_uuid: null,
      created_by_name: actor,
    } as unknown as QuoteDetail);
  Object.assign(q, {
    currency: str(b.currency) || 'TRY',
    customer_uuid: customer!.uuid,
    customer_name: customer!.name,
    customer_phone: customer!.phone,
    customer_email: customer!.email,
    lead_uuid: (b.lead_uuid as string) || null,
    vehicle_uuid: vehicle?.uuid ?? null,
    vehicle_plate: vehicle?.plate ?? str(vehicleInput?.plate).toLocaleUpperCase('tr-TR'),
    vehicle_label: vehicle
      ? `${vehicle.brand_name} ${vehicle.model_name} · ${vehicle.year}`
      : str(vehicleInput?.label).trim() || (model ? `${model.brand_name} ${model.model_name}` : ''),
    vehicle_model_uuid: vehicle?.model_uuid ?? model?.model_uuid ?? null,
    vehicle_model_label: vehicle ? `${vehicle.brand_name} ${vehicle.model_name}` : model ? `${model.brand_name} ${model.model_name}` : '',
    vehicle_year: vehicle?.year ?? vehicleInput?.year ?? null,
    prices_include_vat: pricesIncludeVat,
    discount_type: discountType,
    discount_value: money(num(b.discount_value)),
    valid_until: str(b.valid_until) || null,
    notes: str(b.notes),
    terms: str(b.terms),
    ...totals,
    updated_at: at,
  });
  q.share_url = `https://app.otopoly.com/q/${q.uuid.slice(0, 8)}`;
  if (!existing) {
    db.quotes.push(q);
    quoteEvent(ctx, q, { kind: 'created', to_status: 'draft' });
    const lead = q.lead_uuid ? db.leads.find((l) => l.uuid === q.lead_uuid) : null;
    if (lead && ctx) {
      leadEvent(ctx, lead, { kind: 'quote_created', ref_type: 'quote', ref_uuid: q.uuid, ref_label: q.number });
      if (lead.status === 'new' || lead.status === 'contacted') lead.status = 'quoted';
    }
  } else {
    quoteEvent(ctx, q, { kind: 'updated' });
  }
  return refreshQuote(q);
}

route('GET', '/v1/tenant/quotes/summary', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.read');
  const quotes = getDb().quotes.map(refreshQuote);
  const open = quotes.filter((q) => ['draft', 'sent', 'viewed'].includes(q.status));
  const month = istanbulDay().slice(0, 7);
  const acceptedMonth = quotes.filter((q) => q.status === 'accepted' && (q.accepted_at ?? '').slice(0, 7) === month);
  const soon = istanbulDay(new Date(Date.now() + 3 * 86400000));
  return {
    currency: 'TRY',
    open_count: open.length,
    draft_count: quotes.filter((q) => q.status === 'draft').length,
    awaiting_count: quotes.filter((q) => q.status === 'sent' || q.status === 'viewed').length,
    accepted_pending_count: quotes.filter((q) => q.status === 'accepted' && !q.job_uuid).length,
    pending_total: money(open.reduce((s, q) => s + num(q.grand_total), 0)),
    expiring_soon: open.filter((q) => q.valid_until && q.valid_until <= soon).length,
    accepted_month: acceptedMonth.length,
    accepted_month_total: money(acceptedMonth.reduce((s, q) => s + num(q.grand_total), 0)),
  };
});

route('GET', '/v1/tenant/quotes', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.read');
  const q = ctx.query;
  let items = getDb().quotes.map(refreshQuote);
  // Backend: `status=open` = draft/sent/viewed + accepted not yet converted (quotes.sql).
  if (q.status === 'open') items = items.filter((x) => ['draft', 'sent', 'viewed'].includes(x.status) || (x.status === 'accepted' && !x.job_uuid));
  else if (q.status) items = items.filter((x) => q.status.split(',').includes(x.status));
  if (q.customer_uuid) items = items.filter((x) => x.customer_uuid === q.customer_uuid);
  if (q.lead_uuid) items = items.filter((x) => x.lead_uuid === q.lead_uuid);
  items = search(items, q.q, ['number', 'customer_name', 'vehicle_plate']);
  const page = paginate(sortBy(items, q.sort, '-created_at'), q, 50);
  return { ...page, items: page.items.map(quoteListItem) };
});

route('POST', '/v1/tenant/quotes', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  return saveQuote(ctx, null, ctx.body, actorName(ctx));
});

route('GET', '/v1/tenant/quotes/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.read');
  return refreshQuote(findQuote(ctx));
});

route('PUT', '/v1/tenant/quotes/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  const q = refreshQuote(findQuote(ctx));
  if (!q.can_edit) fail(409, 'CONFLICT', 'Quote can no longer be edited');
  return saveQuote(ctx, q, ctx.body, actorName(ctx));
});

route('POST', '/v1/tenant/quotes/:uuid/duplicate', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  const src = findQuote(ctx);
  return saveQuote(
    ctx,
    null,
    {
      customer_uuid: src.customer_uuid,
      lead_uuid: src.lead_uuid,
      vehicle: src.vehicle_uuid ? { vehicle_uuid: src.vehicle_uuid } : null,
      prices_include_vat: src.prices_include_vat,
      discount_type: src.discount_type,
      discount_value: src.discount_value,
      notes: src.notes,
      terms: src.terms,
      lines: src.lines.map((l) => ({ ...l, unit_price: l.unit_price })),
    },
    actorName(ctx),
  );
});

route('POST', '/v1/tenant/quotes/:uuid/status', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  const q = refreshQuote(findQuote(ctx));
  const to = str(ctx.body.status) as QuoteStatus;
  if (!q.allowed_statuses.includes(to)) fail(409, 'INVALID_TRANSITION', `Cannot move from ${q.status} to ${to}`);
  const from = q.status;
  q.status = to;
  const at = now();
  if (to === 'sent') q.sent_at ??= at;
  if (to === 'accepted') q.accepted_at = at;
  if (to === 'rejected') q.rejected_at = at;
  if (to === 'cancelled') q.cancelled_at = at;
  q.decision_note = str(ctx.body.note);
  q.decision_channel = 'tenant';
  quoteEvent(ctx, q, { kind: 'status_changed', from_status: from, to_status: to, body: str(ctx.body.note) });
  const lead = q.lead_uuid ? getDb().leads.find((l) => l.uuid === q.lead_uuid) : null;
  if (lead && (to === 'accepted' || to === 'rejected')) leadEvent(ctx, lead, { kind: to === 'accepted' ? 'quote_accepted' : 'quote_rejected', ref_type: 'quote', ref_uuid: q.uuid, ref_label: q.number });
  return refreshQuote(q);
});

route('GET', '/v1/tenant/quotes/:uuid/send-preview', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.read');
  const q = findQuote(ctx);
  const org = getDb().organizations[0];
  return {
    channel: 'whatsapp',
    channel_connected: true,
    customer_phone: q.customer_phone,
    message: `Merhaba ${q.customer_name}, ${org.name} olarak hazırladığımız ${q.number} numaralı teklifimizi inceleyebilirsiniz: ${q.share_url}`,
    template_active: true,
    attachment_file_name: `${q.number}.pdf`,
  };
});

route('POST', '/v1/tenant/quotes/:uuid/send', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  const q = refreshQuote(findQuote(ctx));
  if (!q.can_send) fail(409, 'CONFLICT', 'Quote cannot be sent in its current status');
  const at = now();
  // Backend marks the quote sent even when the messenger fails; the delivery row carries the error.
  const noPhone = !q.customer_phone;
  const delivery = {
    uuid: uuid(),
    channel: str(ctx.body.channel) || 'whatsapp',
    recipient: q.customer_phone,
    status: (noPhone ? 'failed' : 'sent') as 'sent' | 'failed',
    error: noPhone ? 'customer_no_phone: the customer has no phone number' : '',
    attempt_count: 1,
    last_attempt_at: at,
    sent_at: noPhone ? null : at,
    created_at: at,
  };
  q.deliveries.unshift(delivery);
  const from = q.status;
  if (q.status === 'draft') q.status = 'sent';
  q.sent_at ??= at;
  quoteEvent(ctx, q, { kind: from === 'draft' ? 'status_changed' : 'resent', from_status: from, to_status: q.status });
  if (Array.isArray(ctx.body.reminders)) setReminders(ctx, q, ctx.body.reminders as { kind: string; date?: string }[]);
  const lead = q.lead_uuid ? getDb().leads.find((l) => l.uuid === q.lead_uuid) : null;
  if (lead) leadEvent(ctx, lead, { kind: 'quote_sent', ref_type: 'quote', ref_uuid: q.uuid, ref_label: q.number });
  return { quote: refreshQuote(q), delivery };
});

route('POST', '/v1/tenant/quotes/:uuid/deliveries/:did/retry', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  const q = findQuote(ctx);
  const d = q.deliveries.find((x) => x.uuid === ctx.params.did);
  if (!d) notFound('Delivery');
  if (!q.customer_phone) {
    d!.attempt_count += 1;
    d!.last_attempt_at = now();
    return { quote: refreshQuote(q), delivery: d };
  }
  d!.status = 'sent';
  d!.error = '';
  d!.attempt_count += 1;
  d!.last_attempt_at = now();
  d!.sent_at = now();
  return { quote: refreshQuote(q), delivery: d };
});

function setReminders(ctx: MockCtx, q: QuoteDetail, inputs: { kind: string; date?: string }[]) {
  if (!q.valid_until) fail(400, 'VALIDATION_ERROR', 'Set a validity date first', [{ field: 'valid_until', message: 'required' }]);
  const offsets: Record<string, number> = { before_3d: 3, before_1d: 1, last_day: 0 };
  q.reminders = inputs.map((r) => {
    const fire =
      r.kind === 'custom' && r.date
        ? new Date(`${r.date}T09:00:00+03:00`)
        : new Date(new Date(`${q.valid_until}T09:00:00+03:00`).getTime() - (offsets[r.kind] ?? 0) * 86400000);
    return {
      uuid: uuid(),
      kind: r.kind as 'before_3d' | 'before_1d' | 'last_day' | 'custom',
      offset_days: offsets[r.kind] ?? 0,
      fire_at: fire.toISOString(),
      status: 'scheduled' as const,
      error: '',
      sent_at: null,
      cancelled_at: null,
    };
  });
  quoteEvent(ctx, q, { kind: 'reminders_set' });
}

route('PUT', '/v1/tenant/quotes/:uuid/reminders', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  const q = findQuote(ctx);
  setReminders(ctx, q, Array.isArray(ctx.body.reminders) ? (ctx.body.reminders as { kind: string; date?: string }[]) : []);
  return refreshQuote(q);
});

function convertPlan(q: QuoteDetail) {
  const db = getDb();
  const lines = q.lines.map((l) => {
    const service = l.line_type === 'service' ? db.services.find((s) => s.uuid === l.service_uuid) : null;
    const included = Boolean(service);
    return {
      description: l.description,
      line_type: l.line_type,
      quantity: l.quantity,
      unit_price: money(num(l.line_total) / (num(l.quantity) || 1)),
      line_total: l.line_total,
      included,
      ...(included ? {} : { reason: l.line_type === 'service' ? ('service_deleted' as const) : ('not_a_service' as const) }),
      _service: service,
    };
  });
  const jobTotal = lines.filter((l) => l.included).reduce((s, l) => s + num(l.line_total), 0);
  const skipped = lines.filter((l) => !l.included).reduce((s, l) => s + num(l.line_total), 0);
  return { lines, jobTotal, skipped };
}

route('GET', '/v1/tenant/quotes/:uuid/convert', (ctx) => {
  requirePerm(ctx, 'tenant.quotes.read');
  const db = getDb();
  const q = refreshQuote(findQuote(ctx));
  const plan = convertPlan(q);
  let blocker: string | undefined;
  if (q.job_uuid) blocker = 'already_converted';
  else if (!['accepted', 'sent', 'viewed'].includes(q.status)) blocker = 'status';
  else if (!plan.lines.some((l) => l.included)) blocker = 'no_service_lines';
  const vehicle = q.vehicle_uuid ? db.vehicles.find((v) => v.uuid === q.vehicle_uuid) : null;
  const missing: string[] = [];
  if (!vehicle) {
    if (!q.vehicle_plate) missing.push('plate');
    if (!q.vehicle_model_uuid) missing.push('model');
  }
  return {
    can_convert: !blocker,
    ...(blocker ? { blocker } : {}),
    will_accept: q.status === 'sent' || q.status === 'viewed',
    customer_name: q.customer_name,
    vehicle_uuid: vehicle?.uuid ?? null,
    vehicle_label: vehicle ? `${vehicle.brand_name} ${vehicle.model_name} · ${vehicle.year}` : q.vehicle_label,
    plate: vehicle?.plate ?? q.vehicle_plate,
    creates_vehicle: !vehicle,
    missing,
    customer_vehicles: vehicle
      ? []
      : db.vehicles.filter((v) => v.customer_uuid === q.customer_uuid).map((v) => ({ uuid: v.uuid, label: `${v.plate} · ${v.brand_name} ${v.model_name}` })),
    lines: plan.lines.map(({ _service, ...l }) => l),
    job_total: money(plan.jobTotal),
    skipped_total: money(plan.skipped),
    currency: q.currency,
    lead_uuid: q.lead_uuid,
  };
});

route('POST', '/v1/tenant/quotes/:uuid/convert', async (ctx) => {
  requirePerm(ctx, 'tenant.quotes.write');
  requirePerm(ctx, 'tenant.jobs.write');
  const db = getDb();
  const q = refreshQuote(findQuote(ctx));
  if (q.job_uuid) fail(409, 'CONFLICT', 'Quote already converted');
  if (!q.can_convert) fail(409, 'CONFLICT', 'Quote cannot be converted in its current status');
  const plan = convertPlan(q);
  if (!plan.lines.some((l) => l.included)) fail(409, 'CONFLICT', 'Quote has no service lines');

  // Vehicle: existing, picked, or created from plate + model (only missing fields are asked).
  let vehicleUuid = (ctx.body.vehicle_uuid as string) || q.vehicle_uuid;
  if (!vehicleUuid) {
    const plate = (str(ctx.body.plate) || q.vehicle_plate).toLocaleUpperCase('tr-TR').trim();
    const modelUuid = (ctx.body.model_uuid as string) || q.vehicle_model_uuid;
    const year = num(ctx.body.year ?? q.vehicle_year);
    const errors: { field: string; message: string }[] = [];
    if (!plate) errors.push({ field: 'plate', message: 'required' });
    if (!modelUuid) errors.push({ field: 'model_uuid', message: 'required' });
    if (errors.length) fail(400, 'VALIDATION_ERROR', 'Vehicle details required', errors);
    const cat = db.vehicleCatalog.find((m) => m.model_uuid === modelUuid && (!year || m.year === year)) ?? db.vehicleCatalog.find((m) => m.model_uuid === modelUuid);
    if (!cat) notFound('Vehicle model');
    const customer = db.customers.find((c) => c.uuid === q.customer_uuid)!;
    const v = {
      uuid: uuid(),
      customer_uuid: customer.uuid,
      plate,
      brand_uuid: cat!.brand_uuid,
      brand_name: cat!.brand_name,
      logo_url: null,
      model_uuid: cat!.model_uuid,
      model_name: cat!.model_name,
      year: year || cat!.year,
      created_at: now(),
    };
    db.vehicles.push(v);
    customer.vehicle_count += 1;
    vehicleUuid = v.uuid;
  }

  const jobRoute = matchRoute('POST', '/v1/tenant/jobs')!;
  const notes = [str(ctx.body.notes), ...plan.lines.filter((l) => !l.included).map((l) => `• ${l.description} (${l.quantity})`)].filter(Boolean).join('\n');
  const job = (await jobRoute.route.handler({
    ...ctx,
    params: {},
    body: {
      customer_uuid: q.customer_uuid,
      vehicle_uuid: vehicleUuid,
      assignee_uuid: ctx.body.assignee_uuid ?? undefined,
      notes,
      lines: plan.lines.filter((l) => l.included).map((l) => ({ service_uuid: l._service!.uuid, unit_price: l.unit_price, qty: l.quantity })),
    },
  })) as { uuid: string };

  const at = now();
  if (q.status !== 'accepted') {
    quoteEvent(ctx, q, { kind: 'status_changed', from_status: q.status, to_status: 'accepted' });
    q.status = 'accepted';
    q.accepted_at = at;
  }
  q.job_uuid = job.uuid;
  q.converted_at = at;
  quoteEvent(ctx, q, { kind: 'converted', body: job.uuid });
  const lead = q.lead_uuid ? db.leads.find((l) => l.uuid === q.lead_uuid) : null;
  if (lead) {
    leadEvent(ctx, lead, { kind: 'job_created', ref_type: 'job', ref_uuid: job.uuid, ref_label: q.number });
    if (lead.status !== 'won') {
      leadEvent(ctx, lead, { kind: 'status_changed', from_value: lead.status, to_value: 'won' });
      lead.status = 'won';
      lead.closed_at = at;
    }
  }
  return { job_uuid: job.uuid, quote: refreshQuote(q) };
});
