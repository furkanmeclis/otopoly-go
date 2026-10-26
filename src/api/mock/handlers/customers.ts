import type { Customer, CustomerActivityEntry, CustomerDetail } from '@/features/customers/services/customers.service';

import { bool, fail, type MockCtx, notFound, now, num, paginate, requireFields, requirePerm, resourceMeta, route, search, sortBy, stableUuid, str, uuid } from '../core';
import { getDb, type MockVehicle } from '../db';
import { orgStore } from './contracts';

function normalizePlate(raw: string) {
  return raw.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ').trim();
}

function vehicleView(v: MockVehicle) {
  const { customer_uuid: _c, ...rest } = v;
  return rest;
}

function detail(c: Customer): CustomerDetail {
  const db = getDb();
  return { ...c, vehicles: db.vehicles.filter((v) => v.customer_uuid === c.uuid).map(vehicleView) };
}

function find(ctx: MockCtx) {
  const c = getDb().customers.find((x) => x.uuid === ctx.params.uuid);
  if (!c) notFound('Customer');
  return c!;
}

function createVehicle(customer: Customer, input: Record<string, unknown>, field = 'vehicle') {
  const db = getDb();
  const plate = normalizePlate(str(input.plate));
  if (!plate) fail(400, 'VALIDATION_ERROR', 'Plate is required', [{ field: `${field}.plate`, message: 'required' }]);
  if (db.vehicles.some((v) => v.plate.replace(/\s/g, '') === plate.replace(/\s/g, ''))) {
    fail(409, 'CONFLICT', 'A vehicle with this plate already exists', [{ field: `${field}.plate`, message: 'duplicate' }]);
  }
  const cat = db.vehicleCatalog.find((x) => x.model_uuid === input.model_uuid && x.year === num(input.year));
  if (!cat) fail(400, 'VALIDATION_ERROR', 'Pick a vehicle model', [{ field: `${field}.model_uuid`, message: 'required' }]);
  const v: MockVehicle = {
    uuid: uuid(),
    customer_uuid: customer.uuid,
    plate,
    brand_uuid: cat!.brand_uuid,
    brand_name: cat!.brand_name,
    logo_url: null,
    model_uuid: cat!.model_uuid,
    model_name: cat!.model_name,
    year: cat!.year,
    created_at: now(),
  };
  db.vehicles.push(v);
  customer.vehicle_count += 1;
  customer.updated_at = now();
  return v;
}

route('GET', '/v1/tenant/customers/meta', (ctx) => {
  requirePerm(ctx, 'tenant.customers.read');
  return resourceMeta('tenant.customers', 'name', { read: true, create: ctx.permissions.has('tenant.customers.write'), update: ctx.permissions.has('tenant.customers.write'), search: true, filter: true, sort: true, export: true });
});

route('GET', '/v1/tenant/customers', (ctx) => {
  requirePerm(ctx, 'tenant.customers.read');
  const db = getDb();
  let items = db.customers;
  if (ctx.query.kind) items = items.filter((c) => c.kind === ctx.query.kind);
  if (ctx.query.is_active) items = items.filter((c) => String(c.is_active) === ctx.query.is_active);
  items = search(items, ctx.query.q, [
    'name',
    'phone',
    'email',
    'tax_id',
    (c) => db.vehicles.filter((v) => v.customer_uuid === c.uuid).map((v) => v.plate).join(' '),
  ]);
  return paginate(sortBy(items, ctx.query.sort, 'name'), ctx.query);
});

route('POST', '/v1/tenant/customers', (ctx) => {
  requirePerm(ctx, 'tenant.customers.write');
  requireFields(ctx.body, ['name']);
  const b = ctx.body;
  const kind = str(b.kind, 'individual');
  if (kind !== 'individual' && kind !== 'company') fail(400, 'VALIDATION_ERROR', 'Invalid kind', [{ field: 'kind', message: 'invalid' }]);
  const email = str(b.email).trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'VALIDATION_ERROR', 'Invalid email', [{ field: 'email', message: 'invalid' }]);
  const c: Customer = {
    uuid: uuid(),
    name: str(b.name).trim(),
    phone: str(b.phone).trim(),
    email,
    kind: kind as Customer['kind'],
    notes: str(b.notes),
    tax_id: str(b.tax_id),
    tax_office: str(b.tax_office),
    is_active: bool(b.is_active, true),
    vehicle_count: 0,
    cari_account_uuid: null,
    cari_balance: null,
    created_at: now(),
    updated_at: now(),
  };
  const db = getDb();
  db.customers.push(c);
  if (b.vehicle && typeof b.vehicle === 'object') {
    try {
      createVehicle(c, b.vehicle as Record<string, unknown>);
    } catch (error) {
      db.customers = db.customers.filter((x) => x !== c); // same transaction as the backend
      throw error;
    }
  }
  return detail(c);
});

route('GET', '/v1/tenant/customers/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.customers.read');
  return detail(find(ctx));
});

route('PATCH', '/v1/tenant/customers/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.customers.write');
  const c = find(ctx);
  const b = ctx.body;
  if (b.name !== undefined) {
    if (!str(b.name).trim()) fail(400, 'VALIDATION_ERROR', 'Name is required', [{ field: 'name', message: 'required' }]);
    c.name = str(b.name).trim();
  }
  for (const k of ['phone', 'email', 'notes', 'tax_id', 'tax_office'] as const) if (b[k] !== undefined) c[k] = str(b[k]);
  if (b.kind !== undefined) c.kind = str(b.kind) === 'company' ? 'company' : 'individual';
  if (b.is_active !== undefined) c.is_active = bool(b.is_active);
  c.updated_at = now();
  // Keep denormalized names in sync (backend reads them via joins).
  const db = getDb();
  for (const a of db.cariAccounts) if (a.customer_uuid === c.uuid) Object.assign(a, { customer_name: c.name, customer_phone: c.phone });
  return detail(c);
});

// ─── Activity feed ─────────────────────────────────────────────────────────

/**
 * GET /v1/tenant/customers/{uuid}/activity. The mock keeps no audit log: entries are derived from the demo
 * records (creation, close / send / void times) with the backend's action and resource names, newest first.
 * Kinds the caller cannot read are left out (also from `total`), like `activityScopeFrom` in Go.
 */
function customerActivity(ctx: MockCtx, c: Customer): CustomerActivityEntry[] {
  const db = getDb();
  const has = (perm: string) => ctx.permissions.has(perm);
  const ownerUuid = db.memberships.find((m) => m.orgUuid === ctx.orgUuid && m.role === 'owner')?.userUuid;
  const owner = db.users.find((u) => u.uuid === ownerUuid);
  const actor = owner ? { uuid: owner.uuid, name: owner.name, surname: owner.surname } : null;
  const out: CustomerActivityEntry[] = [];
  const add = (action: string, resource: string, subject: CustomerActivityEntry['subject'], resourceUuid: string | null, at: string | null | undefined, payload: Record<string, unknown>, by = actor) => {
    if (!at) return;
    out.push({ uuid: stableUuid(`${action}|${resourceUuid}|${at}`), action, resource, subject, resource_uuid: resourceUuid, payload, actor: by, created_at: at });
  };

  add('tenant.customer.create', 'customer', 'customer', c.uuid, c.created_at, { name: c.name });
  if (c.updated_at && c.updated_at > c.created_at) add('tenant.customer.update', 'customer', 'customer', c.uuid, c.updated_at, { name: c.name });
  for (const v of db.vehicles.filter((x) => x.customer_uuid === c.uuid)) add('tenant.customer.vehicle_add', 'customer_vehicle', 'vehicle', v.uuid, v.created_at, { plate: v.plate });

  const jobs = db.jobs.filter((j) => j._org === ctx.orgUuid && j.customer_uuid === c.uuid);
  if (has('tenant.jobs.read')) {
    for (const j of jobs) {
      add('jobs.create', 'jobs.job', 'job', j.uuid, j.created_at, { plate: j.plate });
      if (j.paid_at) add('jobs.close', 'jobs.job', 'job', j.uuid, j.paid_at, { plate: j.plate });
      if (j.status === 'cancelled') add('jobs.cancel', 'jobs.job', 'job', j.uuid, j.updated_at, { plate: j.plate });
      if (j.status === 'voided') add('jobs.void', 'jobs.job', 'job', j.uuid, j.updated_at, { plate: j.plate });
    }
  }
  if (has('tenant.jobs.read') && has('tenant.contracts.read')) {
    const jobUuids = new Set(jobs.map((j) => j.uuid));
    const { s, org } = orgStore(ctx);
    for (const k of s.instances.filter((x) => x._org === org && jobUuids.has(x.subject_uuid))) {
      add('tenant.contract_instance.create', 'contract_instance', 'contract', k.uuid, k.created_at, { title: k.title, number: k.number_label });
      if (k.status === 'executed') add('tenant.contract_instance.sign', 'contract_instance', 'contract', k.uuid, k.executed_at, { title: k.title, number: k.number_label });
      if (k.status === 'voided') add('tenant.contract_instance.void', 'contract_instance', 'contract', k.uuid, k.updated_at, { title: k.title, number: k.number_label });
    }
  }
  if (has('tenant.sales.read')) {
    for (const sale of db.sales.filter((x) => x.customer_uuid === c.uuid)) {
      add('tenant.sales.create', 'sale', 'sale', sale.uuid, sale.created_at, { total: sale.total_amount });
      if (sale.voided_at) add('tenant.sales.void', 'sale', 'sale', sale.uuid, sale.voided_at, { total: sale.total_amount });
    }
  }
  if (has('tenant.quotes.read')) {
    for (const q of db.quotes.filter((x) => x.customer_uuid === c.uuid)) {
      add('tenant.quote.create', 'quote', 'quote', q.uuid, q.created_at, { number: q.number });
      if (q.sent_at) add('tenant.quote.send', 'quote', 'quote', q.uuid, q.sent_at, { number: q.number });
      if (q.status === 'accepted' || q.status === 'rejected') add('tenant.quote.status', 'quote', 'quote', q.uuid, q.updated_at, { number: q.number, to: q.status });
    }
  }
  if (has('tenant.leads.read')) {
    for (const l of db.leads.filter((x) => x.customer_uuid === c.uuid)) {
      add('tenant.lead.create', 'lead', 'lead', l.uuid, l.created_at, { name: l.interest });
      if (l.status !== 'new' && l.updated_at > l.created_at) add('tenant.lead.status', 'lead', 'lead', l.uuid, l.updated_at, { name: l.interest, to: l.status });
    }
  }
  if (has('tenant.cari.read') && c.cari_account_uuid) {
    for (const e of db.cariEntries.filter((x) => x.account_uuid === c.cari_account_uuid && x.type !== 'opening')) {
      add(`cari.${e.type}`, 'cari.entry', 'cari_entry', e.uuid, e.created_at, { amount: e.amount, name: e.description });
      if (e.voided_at) add('cari.entry_void', 'cari.entry', 'cari_entry', e.uuid, e.voided_at, { amount: e.amount, name: e.description });
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

route('GET', '/v1/tenant/customers/:uuid/activity', (ctx) => {
  requirePerm(ctx, 'tenant.customers.read');
  return paginate(customerActivity(ctx, find(ctx)), ctx.query);
});

route('DELETE', '/v1/tenant/customers/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.customers.write');
  const c = find(ctx);
  if (num(c.cari_balance) !== 0) fail(409, 'CONFLICT', 'conflict: cannot delete customer with outstanding cari balance');
  const db = getDb();
  db.customers = db.customers.filter((x) => x !== c);
  db.vehicles = db.vehicles.filter((v) => v.customer_uuid !== c.uuid);
  return { deleted: true };
});

route('POST', '/v1/tenant/customers/:uuid/vehicles', (ctx) => {
  requirePerm(ctx, 'tenant.customers.write');
  return vehicleView(createVehicle(find(ctx), ctx.body, 'vehicle'));
});

route('DELETE', '/v1/tenant/customer-vehicles/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.customers.write');
  const db = getDb();
  const v = db.vehicles.find((x) => x.uuid === ctx.params.uuid);
  if (!v) notFound('Vehicle');
  if (db.jobs.some((j) => j.vehicle_uuid === v!.uuid && (j.status === 'in_progress' || j.status === 'ready'))) {
    fail(409, 'CONFLICT', 'Vehicle has an open job');
  }
  db.vehicles = db.vehicles.filter((x) => x !== v);
  const c = db.customers.find((x) => x.uuid === v!.customer_uuid);
  if (c) c.vehicle_count = Math.max(0, c.vehicle_count - 1);
  return { deleted: true };
});

route('GET', '/v1/tenant/vehicle-catalog/search', (ctx) => {
  requirePerm(ctx, 'tenant.customers.read');
  const db = getDb();
  const items = search(db.vehicleCatalog, ctx.query.q, [(x) => `${x.brand_name} ${x.model_name} ${x.year}`]).slice(0, num(ctx.query.limit) || 20);
  return { items };
});
