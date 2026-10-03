import type { Customer, CustomerDetail } from '@/features/customers/services/customers.service';

import { bool, fail, type MockCtx, notFound, now, num, paginate, requireFields, requirePerm, resourceMeta, route, search, sortBy, str, uuid } from '../core';
import { getDb, type MockVehicle } from '../db';

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
