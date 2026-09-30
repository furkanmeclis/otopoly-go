import type {
  CatalogCategory,
  CatalogProduct,
  CatalogService,
  CatalogSummary,
} from '@/features/catalog/services/catalog.service';

import { bool, fail, money, notFound, now, num, paginate, requireFields, requireOwner, requirePerm, route, search, sortBy, str, uuid, type MockCtx } from '../core';
import { getDb } from '../db';
import { moveStock } from '../ops';

const readPerm = 'tenant.catalog.read';
const writePerm = 'tenant.catalog.write';

function categoryName(uuid_: unknown) {
  return getDb().catalogCategories.find((c) => c.uuid === uuid_)?.name ?? null;
}

function decimal(field: string, v: unknown, fallback = '0') {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) fail(400, 'VALIDATION_ERROR', `${field} must be a non-negative number`, [{ field, message: 'invalid' }]);
  return String(n);
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr');

/** Backend unique indexes: product name, SKU and barcode per organization (409 CONFLICT). */
function assertProductUnique(p: Pick<CatalogProduct, 'name' | 'sku' | 'barcode'>, selfUuid?: string) {
  const others = getDb().products.filter((x) => x.uuid !== selfUuid);
  if (others.some((x) => same(x.name, p.name))) fail(409, 'CONFLICT', 'product with this name already exists', [{ field: 'name', message: 'taken' }]);
  if (p.sku.trim() && others.some((x) => x.sku && same(x.sku, p.sku))) fail(409, 'CONFLICT', 'product with this SKU already exists', [{ field: 'sku', message: 'taken' }]);
  if (p.barcode.trim() && others.some((x) => x.barcode && same(x.barcode, p.barcode))) fail(409, 'CONFLICT', 'product with this barcode already exists', [{ field: 'barcode', message: 'taken' }]);
}

/** Backend unique index: category name per kind. */
function assertCategoryUnique(name: string, kind: string, selfUuid?: string) {
  if (getDb().catalogCategories.some((c) => c.uuid !== selfUuid && c.kind === kind && same(c.name, name))) {
    fail(409, 'CONFLICT', 'category with this name and kind already exists', [{ field: 'name', message: 'taken' }]);
  }
}

function stockStatus(p: CatalogProduct): CatalogProduct['stock_status'] {
  if (!p.track_stock) return 'untracked';
  const q = num(p.stock_quantity);
  const min = num(p.min_stock_alert);
  return q <= 0 ? 'out_of_stock' : min > 0 && q <= min ? 'low_stock' : 'in_stock';
}

// ─── Summary ───────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/catalog/summary', (ctx) => {
  requirePerm(ctx, readPerm);
  const db = getDb();
  const summary: CatalogSummary = {
    total_products: db.products.length,
    active_products: db.products.filter((p) => p.is_active).length,
    low_stock_products: db.products.filter((p) => p.stock_status === 'low_stock').length,
    out_of_stock_products: db.products.filter((p) => p.stock_status === 'out_of_stock').length,
    total_stock_cost_value: money(db.products.filter((p) => p.track_stock).reduce((s, p) => s + Math.max(0, num(p.stock_quantity)) * num(p.cost_price), 0)),
    total_stock_sale_value: money(db.products.filter((p) => p.track_stock).reduce((s, p) => s + Math.max(0, num(p.stock_quantity)) * num(p.sale_price), 0)),
    total_services: db.services.length,
    active_services: db.services.filter((s) => s.is_active).length,
    total_categories: db.catalogCategories.length,
  };
  return summary;
});

// ─── Products ──────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/catalog/products/meta', (ctx) => {
  requirePerm(ctx, readPerm);
  return { resource: 'catalog.products', capabilities: { read: true, create: ctx.permissions.has(writePerm), search: true, filter: true, export: true } };
});

route('GET', '/v1/tenant/catalog/products', (ctx) => {
  requirePerm(ctx, readPerm);
  const q = ctx.query;
  let items = getDb().products;
  if (q.category_uuid) items = items.filter((p) => p.category_uuid === q.category_uuid);
  if (q.stock_status) items = items.filter((p) => q.stock_status.split(',').includes(p.stock_status));
  if (q.is_active) items = items.filter((p) => String(p.is_active) === q.is_active);
  if (q.track_stock) items = items.filter((p) => String(p.track_stock) === q.track_stock);
  if (q.unit) items = items.filter((p) => p.unit === q.unit);
  items = search(items, q.q, ['name', 'sku', 'barcode', 'category_name']);
  return paginate(sortBy(items, q.sort, 'name'), q);
});

function findProduct(ctx: MockCtx) {
  const p = getDb().products.find((x) => x.uuid === ctx.params.uuid);
  if (!p) notFound('Product');
  return p!;
}

route('POST', '/v1/tenant/catalog/products', (ctx) => {
  requireOwner(ctx, writePerm);
  requireFields(ctx.body, ['name']);
  const b = ctx.body;
  const p: CatalogProduct = {
    uuid: uuid(),
    name: str(b.name).trim(),
    category_uuid: (b.category_uuid as string) || null,
    category_name: categoryName(b.category_uuid),
    sku: str(b.sku),
    barcode: str(b.barcode),
    unit: str(b.unit, 'piece') || 'piece',
    cost_price: money(num(decimal('cost_price', b.cost_price))),
    sale_price: money(num(decimal('sale_price', b.sale_price))),
    vat_rate: decimal('vat_rate', b.vat_rate, '20'),
    currency: 'TRY',
    stock_quantity: decimal('stock_quantity', b.stock_quantity),
    min_stock_alert: decimal('min_stock_alert', b.min_stock_alert),
    track_stock: bool(b.track_stock, true),
    stock_status: 'in_stock',
    is_active: bool(b.is_active, true),
    description: str(b.description),
    created_at: now(),
    updated_at: now(),
  };
  p.stock_status = stockStatus(p);
  assertProductUnique(p);
  getDb().products.push(p);
  return p;
});

route('GET', '/v1/tenant/catalog/products/:uuid', (ctx) => {
  requirePerm(ctx, readPerm);
  return findProduct(ctx);
});

route('PATCH', '/v1/tenant/catalog/products/:uuid', (ctx) => {
  requireOwner(ctx, writePerm);
  const p = findProduct(ctx);
  const b = ctx.body;
  // Validate everything before touching the row so a failed PATCH leaves it unchanged.
  if (b.name !== undefined && !str(b.name).trim()) fail(400, 'VALIDATION_ERROR', 'Name is required', [{ field: 'name', message: 'required' }]);
  const next = {
    name: b.name !== undefined ? str(b.name).trim() : p.name,
    sku: b.sku !== undefined ? str(b.sku) : p.sku,
    barcode: b.barcode !== undefined ? str(b.barcode) : p.barcode,
  };
  assertProductUnique(next, p.uuid);
  const cost = b.cost_price !== undefined ? money(num(decimal('cost_price', b.cost_price))) : p.cost_price;
  const sale = b.sale_price !== undefined ? money(num(decimal('sale_price', b.sale_price))) : p.sale_price;
  const vat = b.vat_rate !== undefined ? decimal('vat_rate', b.vat_rate) : p.vat_rate;
  // Backend PATCH accepts an absolute stock_quantity too (the web edit dialog sends it).
  const qty = b.stock_quantity !== undefined ? decimal('stock_quantity', b.stock_quantity) : p.stock_quantity;
  const min = b.min_stock_alert !== undefined ? decimal('min_stock_alert', b.min_stock_alert) : p.min_stock_alert;

  Object.assign(p, next, { cost_price: cost, sale_price: sale, vat_rate: vat, stock_quantity: qty, min_stock_alert: min });
  if (b.category_uuid !== undefined) {
    p.category_uuid = (b.category_uuid as string) || null;
    p.category_name = categoryName(p.category_uuid);
  }
  for (const k of ['unit', 'description'] as const) if (b[k] !== undefined) p[k] = str(b[k]);
  if (b.track_stock !== undefined) p.track_stock = bool(b.track_stock);
  if (b.is_active !== undefined) p.is_active = bool(b.is_active);
  p.stock_status = stockStatus(p);
  p.updated_at = now();
  return p;
});

route('POST', '/v1/tenant/catalog/products/:uuid/stock-adjustment', (ctx) => {
  requireOwner(ctx, writePerm);
  const p = findProduct(ctx);
  if (!p.track_stock) fail(409, 'CONFLICT', 'Stock is not tracked for this product');
  const delta = Number(str(ctx.body.delta).replace(',', '.'));
  if (!Number.isFinite(delta) || delta === 0) fail(400, 'VALIDATION_ERROR', 'delta must be a non-zero number', [{ field: 'delta', message: 'invalid' }]);
  moveStock(getDb(), p.uuid, delta);
  return p;
});

route('DELETE', '/v1/tenant/catalog/products/:uuid', (ctx) => {
  requireOwner(ctx, writePerm);
  const p = findProduct(ctx);
  const db = getDb();
  db.products = db.products.filter((x) => x !== p);
  db.serviceProducts = db.serviceProducts.filter((r) => r.product_uuid !== p.uuid);
  return { deleted: true };
});

// ─── Services ──────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/catalog/services/meta', (ctx) => {
  requirePerm(ctx, readPerm);
  return { resource: 'catalog.services', capabilities: { read: true, create: ctx.permissions.has(writePerm), search: true, filter: true, export: true } };
});

route('GET', '/v1/tenant/catalog/services', (ctx) => {
  requirePerm(ctx, readPerm);
  const q = ctx.query;
  let items = getDb().services;
  if (q.category_uuid) items = items.filter((s) => s.category_uuid === q.category_uuid);
  if (q.is_active) items = items.filter((s) => String(s.is_active) === q.is_active);
  items = search(items, q.q, ['name', 'code', 'category_name']);
  return paginate(sortBy(items, q.sort, 'name'), q);
});

function findService(ctx: MockCtx) {
  const s = getDb().services.find((x) => x.uuid === ctx.params.uuid);
  if (!s) notFound('Service');
  return s!;
}

function serviceProducts(serviceUuid: string) {
  const db = getDb();
  return db.serviceProducts
    .filter((r) => r.service_uuid === serviceUuid)
    .map((r) => {
      const p = db.products.find((x) => x.uuid === r.product_uuid)!;
      return {
        product_uuid: p.uuid,
        name: p.name,
        unit: p.unit,
        qty: r.qty,
        cost_price: p.cost_price,
        track_stock: p.track_stock,
        stock_quantity: p.stock_quantity,
        is_active: p.is_active,
      };
    });
}

route('POST', '/v1/tenant/catalog/services', (ctx) => {
  requireOwner(ctx, writePerm);
  requireFields(ctx.body, ['name']);
  const b = ctx.body;
  const s: CatalogService = {
    uuid: uuid(),
    name: str(b.name).trim(),
    category_uuid: (b.category_uuid as string) || null,
    category_name: categoryName(b.category_uuid),
    code: str(b.code),
    duration_minutes: Math.max(0, Math.round(num(b.duration_minutes))),
    price: money(num(decimal('price', b.price))),
    vat_rate: decimal('vat_rate', b.vat_rate, '20'),
    currency: 'TRY',
    is_active: bool(b.is_active, true),
    description: str(b.description),
    color: str(b.color),
    created_at: now(),
    updated_at: now(),
  };
  getDb().services.push(s);
  return s;
});

route('GET', '/v1/tenant/catalog/services/:uuid/products', (ctx) => {
  requirePerm(ctx, readPerm);
  return { items: serviceProducts(findService(ctx).uuid) };
});

route('PUT', '/v1/tenant/catalog/services/:uuid/products', (ctx) => {
  requireOwner(ctx, writePerm);
  const s = findService(ctx);
  const db = getDb();
  const items = Array.isArray(ctx.body.items) ? (ctx.body.items as { product_uuid: string; qty: string }[]) : [];
  items.forEach((it, i) => {
    if (!db.products.some((p) => p.uuid === it.product_uuid)) fail(400, 'VALIDATION_ERROR', 'Product not found', [{ field: `items[${i}].product_uuid`, message: 'not found' }]);
    if (!(num(it.qty) > 0)) fail(400, 'VALIDATION_ERROR', 'qty must be positive', [{ field: `items[${i}].qty`, message: 'must be > 0' }]);
  });
  db.serviceProducts = db.serviceProducts.filter((r) => r.service_uuid !== s.uuid);
  for (const it of items) db.serviceProducts.push({ service_uuid: s.uuid, product_uuid: it.product_uuid, qty: String(num(it.qty)) });
  return { items: serviceProducts(s.uuid) };
});

route('GET', '/v1/tenant/catalog/services/:uuid', (ctx) => {
  requirePerm(ctx, readPerm);
  return findService(ctx);
});

route('PATCH', '/v1/tenant/catalog/services/:uuid', (ctx) => {
  requireOwner(ctx, writePerm);
  const s = findService(ctx);
  const b = ctx.body;
  if (b.name !== undefined) {
    if (!str(b.name).trim()) fail(400, 'VALIDATION_ERROR', 'Name is required', [{ field: 'name', message: 'required' }]);
    s.name = str(b.name).trim();
  }
  if (b.category_uuid !== undefined) {
    s.category_uuid = (b.category_uuid as string) || null;
    s.category_name = categoryName(s.category_uuid);
  }
  for (const k of ['code', 'description', 'color'] as const) if (b[k] !== undefined) s[k] = str(b[k]);
  if (b.duration_minutes !== undefined) s.duration_minutes = Math.max(0, Math.round(num(b.duration_minutes)));
  if (b.price !== undefined) s.price = money(num(decimal('price', b.price)));
  if (b.vat_rate !== undefined) s.vat_rate = decimal('vat_rate', b.vat_rate);
  if (b.is_active !== undefined) s.is_active = bool(b.is_active);
  s.updated_at = now();
  return s;
});

route('DELETE', '/v1/tenant/catalog/services/:uuid', (ctx) => {
  requireOwner(ctx, writePerm);
  const s = findService(ctx);
  const db = getDb();
  db.services = db.services.filter((x) => x !== s);
  db.serviceProducts = db.serviceProducts.filter((r) => r.service_uuid !== s.uuid);
  return { deleted: true };
});

// ─── Categories ────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/catalog/categories/meta', (ctx) => {
  requirePerm(ctx, readPerm);
  return { resource: 'catalog.categories', capabilities: { read: true, create: ctx.permissions.has(writePerm), search: true, filter: true } };
});

route('GET', '/v1/tenant/catalog/categories', (ctx) => {
  requirePerm(ctx, readPerm);
  let items = getDb().catalogCategories;
  if (ctx.query.kind) items = items.filter((c) => c.kind === ctx.query.kind);
  if (ctx.query.is_active) items = items.filter((c) => String(c.is_active) === ctx.query.is_active);
  items = search(items, ctx.query.q, ['name']);
  return { items: sortBy(items, 'kind,sort_order,name') };
});

function findCategory(ctx: MockCtx) {
  const c = getDb().catalogCategories.find((x) => x.uuid === ctx.params.uuid);
  if (!c) notFound('Category');
  return c!;
}

route('POST', '/v1/tenant/catalog/categories', (ctx) => {
  requireOwner(ctx, writePerm);
  requireFields(ctx.body, ['name', 'kind']);
  const kind = str(ctx.body.kind);
  if (kind !== 'product' && kind !== 'service') fail(400, 'VALIDATION_ERROR', 'Invalid kind', [{ field: 'kind', message: 'invalid' }]);
  assertCategoryUnique(str(ctx.body.name), kind);
  const db = getDb();
  const parent = ctx.body.parent_uuid ? db.catalogCategories.find((c) => c.uuid === ctx.body.parent_uuid) : null;
  const c: CatalogCategory = {
    uuid: uuid(),
    name: str(ctx.body.name).trim(),
    kind: kind as CatalogCategory['kind'],
    parent_uuid: parent?.uuid ?? null,
    parent_name: parent?.name ?? null,
    sort_order: num(ctx.body.sort_order),
    is_active: bool(ctx.body.is_active, true),
    created_at: now(),
    updated_at: now(),
  };
  db.catalogCategories.push(c);
  return c;
});

route('GET', '/v1/tenant/catalog/categories/:uuid', (ctx) => {
  requirePerm(ctx, readPerm);
  return findCategory(ctx);
});

route('PATCH', '/v1/tenant/catalog/categories/:uuid', (ctx) => {
  requireOwner(ctx, writePerm);
  const c = findCategory(ctx);
  const db = getDb();
  let kind = c.kind;
  if (ctx.body.kind !== undefined) {
    const k = str(ctx.body.kind);
    if (k !== 'product' && k !== 'service') fail(400, 'VALIDATION_ERROR', 'Invalid kind', [{ field: 'kind', message: 'invalid' }]);
    kind = k as CatalogCategory['kind'];
  }
  const name = (ctx.body.name !== undefined ? str(ctx.body.name).trim() : '') || c.name;
  assertCategoryUnique(name, kind, c.uuid);
  if (ctx.body.parent_uuid && ctx.body.parent_uuid === c.uuid) fail(400, 'VALIDATION_ERROR', 'A category cannot be its own parent', [{ field: 'parent_uuid', message: 'invalid' }]);
  c.kind = kind;
  c.name = name;
  if (ctx.body.sort_order !== undefined) c.sort_order = num(ctx.body.sort_order);
  if (ctx.body.is_active !== undefined) c.is_active = bool(ctx.body.is_active);
  if (ctx.body.parent_uuid !== undefined) {
    const parent = db.catalogCategories.find((x) => x.uuid === ctx.body.parent_uuid);
    c.parent_uuid = parent?.uuid ?? null;
    c.parent_name = parent?.name ?? null;
  }
  c.updated_at = now();
  for (const p of db.products) if (p.category_uuid === c.uuid) p.category_name = c.name;
  for (const s of db.services) if (s.category_uuid === c.uuid) s.category_name = c.name;
  return c;
});

route('DELETE', '/v1/tenant/catalog/categories/:uuid', (ctx) => {
  requireOwner(ctx, writePerm);
  const c = findCategory(ctx);
  const db = getDb();
  if (db.products.some((p) => p.category_uuid === c.uuid) || db.services.some((s) => s.category_uuid === c.uuid)) {
    fail(409, 'CONFLICT', 'Category is in use');
  }
  db.catalogCategories = db.catalogCategories.filter((x) => x !== c);
  return { deleted: true };
});
