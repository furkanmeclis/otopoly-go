/**
 * Tenant export and import jobs (backend `internal/modules/exports` + `imports`).
 * Exports: queued by the per-resource `POST …/export` routes and "processed" by elapsed time
 * (pending → processing → completed) so the app's polling shows real progress.
 * Imports: seeded history (uploads are web-only on mobile) with list / detail / rollback.
 * State is attached to the demo DB object so it persists and resets with it.
 */
import type { ExportJob, ImportJob } from '@/features/io/types';

import { fail, notFound, now, paginate, requireOwner, requirePerm, route, str, uuid, validation, type MockCtx } from '../core';
import { getDb, type MockDb } from '../db';

type ExportRow = ExportJob & { _org: string; _query: Record<string, string>; _rows: number };
type ImportRow = ImportJob & { _org: string };
type Store = { exports: ExportRow[]; imports: ImportRow[]; seededOrgs: string[] };

const FORMATS = ['pdf', 'xlsx', 'csv', 'json'];
const PROCESSING_AFTER_MS = 1500;
const COMPLETED_AFTER_MS = 4000;
const ROLLBACK_WINDOW_MS = 24 * 3600_000;

function store(): Store {
  const db = getDb() as MockDb & { _io?: Store };
  db._io ??= { exports: [], imports: [], seededOrgs: [] };
  return db._io;
}

/** Row count the export would contain, from the demo data. */
function rowCount(org: string, resource: string) {
  const db = getDb();
  switch (resource) {
    case 'tenant.jobs':
      return db.jobs.filter((j) => j._org === org).length;
    case 'tenant.sales':
      return db.sales.length;
    case 'tenant.finance.transactions':
      return db.transactions.length;
    case 'tenant.finance.accounts':
      return db.financeAccounts.length;
    case 'tenant.finance.categories':
      return db.financeCategories.length;
    case 'tenant.cari':
      return db.cariAccounts.length;
    case 'tenant.suppliers':
      return db.suppliers.length;
    case 'tenant.purchases':
      return db.purchases.length;
    case 'tenant.reports':
      return 30;
    default:
      return 0;
  }
}

function seed(ctx: MockCtx) {
  const s = store();
  const org = ctx.orgUuid!;
  if (s.seededOrgs.includes(org)) return { s, org };
  s.seededOrgs.push(org);
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const exp = (resource: string, format: string, hours: number, status = 'completed', error: string | null = null): ExportRow => ({
    uuid: uuid(),
    resource,
    format,
    status,
    row_count: status === 'completed' ? rowCount(org, resource) : 0,
    error,
    download_url: status === 'completed' ? '' : null,
    created_at: ago(hours),
    _org: org,
    _query: {},
    _rows: rowCount(org, resource),
  });
  s.exports.push(
    exp('tenant.finance.transactions', 'xlsx', 3),
    exp('tenant.jobs', 'pdf', 26),
    exp('tenant.cari', 'csv', 50, 'failed', 'export worker timed out'),
  );
  s.imports.push(
    {
      uuid: uuid(),
      resource: 'tenant.finance.categories',
      format: 'xlsx',
      status: 'applied',
      mapping: { 'Kategori adı': 'name', Tür: 'kind', Sıra: 'sort_order' },
      defaults: { is_active: 'true' },
      preview_summary: { total: 6, valid: 5, invalid: 1, errors: [{ index: 4, field: 'kind', error: 'kind must be income or expense' }] },
      error: null,
      applied_at: ago(2),
      rollback_until: new Date(Date.parse(ago(2)) + ROLLBACK_WINDOW_MS).toISOString(),
      created_at: ago(2.1),
      _org: org,
    },
    {
      uuid: uuid(),
      resource: 'tenant.finance.accounts',
      format: 'csv',
      status: 'applied',
      mapping: { Hesap: 'name', Tip: 'type', Açılış: 'opening_balance' },
      defaults: { currency: 'TRY' },
      preview_summary: { total: 3, valid: 3, invalid: 0, errors: [] },
      error: null,
      applied_at: ago(72),
      rollback_until: new Date(Date.parse(ago(72)) + ROLLBACK_WINDOW_MS).toISOString(),
      created_at: ago(72.2),
      _org: org,
    },
    {
      uuid: uuid(),
      resource: 'tenant.catalog.products',
      format: 'xlsx',
      status: 'failed',
      mapping: { Ürün: 'name' },
      defaults: {},
      preview_summary: { total: 12, valid: 0, invalid: 12, errors: [{ index: 1, field: 'name', error: 'required' }] },
      error: 'no valid rows to apply',
      applied_at: null,
      rollback_until: null,
      created_at: ago(120),
      _org: org,
    },
  );
  return { s, org };
}

/** Advance a queued export by elapsed time (the worker in the real backend). */
function tick(row: ExportRow) {
  if (row.status !== 'pending' && row.status !== 'processing') return;
  const age = Date.now() - Date.parse(row.created_at);
  if (age >= COMPLETED_AFTER_MS) {
    row.status = 'completed';
    row.row_count = row._rows;
    row.download_url = `/v1/tenant/exports/${row.uuid}/download`;
  } else if (age >= PROCESSING_AFTER_MS) row.status = 'processing';
}

const toExport = (row: ExportRow): ExportJob => {
  tick(row);
  const { _org, _query, _rows, ...rest } = row;
  return { ...rest, download_url: rest.status === 'completed' ? `/v1/tenant/exports/${rest.uuid}/download` : null };
};
const toImport = ({ _org, ...rest }: ImportRow): ImportJob => rest;

// ─── Exports ─────────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/exports', (ctx) => {
  requirePerm(ctx, 'tenant.finance.export');
  const { s, org } = seed(ctx);
  const items = s.exports.filter((x) => x._org === org).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return paginate(items.map(toExport), ctx.query);
});

route('GET', '/v1/tenant/exports/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.finance.export');
  const { s, org } = seed(ctx);
  const row = s.exports.find((x) => x.uuid === ctx.params.uuid && x._org === org) ?? (notFound('Export job') as never);
  return toExport(row);
});

route('GET', '/v1/tenant/exports/:uuid/download', (ctx) => {
  requirePerm(ctx, 'tenant.finance.export');
  const { s, org } = seed(ctx);
  const row = s.exports.find((x) => x.uuid === ctx.params.uuid && x._org === org) ?? (notFound('Export job') as never);
  tick(row);
  if (row.status !== 'completed') fail(409, 'CONFLICT', 'export is not ready');
  return { url: `/v1/tenant/exports/${row.uuid}/download` };
});

const EXPORT_ROUTES: [string, string, string][] = [
  ['/v1/tenant/finance/accounts/export', 'tenant.finance.accounts', 'tenant.finance.export'],
  ['/v1/tenant/finance/categories/export', 'tenant.finance.categories', 'tenant.finance.export'],
  ['/v1/tenant/finance/transactions/export', 'tenant.finance.transactions', 'tenant.finance.export'],
  ['/v1/tenant/cari/export', 'tenant.cari', 'tenant.cari.export'],
  ['/v1/tenant/jobs/export', 'tenant.jobs', 'tenant.jobs.export'],
  ['/v1/tenant/sales/export', 'tenant.sales', 'tenant.sales.export'],
  ['/v1/tenant/suppliers/export', 'tenant.suppliers', 'tenant.suppliers.export'],
  ['/v1/tenant/purchases/export', 'tenant.purchases', 'tenant.purchases.export'],
  ['/v1/tenant/reports/export', 'tenant.reports', 'tenant.reports.export'],
];

for (const [path, resource, perm] of EXPORT_ROUTES) {
  route('POST', path, (ctx) => {
    requirePerm(ctx, perm);
    const format = str(ctx.body.format).trim().toLowerCase();
    if (!FORMATS.includes(format)) validation([{ field: 'format', message: 'format must be one of pdf, xlsx, csv, json' }]);
    const { s, org } = seed(ctx);
    const raw = (ctx.body.query ?? {}) as Record<string, unknown>;
    const query = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, str(v)]));
    const row: ExportRow = {
      uuid: uuid(),
      resource,
      format,
      status: 'pending',
      row_count: 0,
      error: null,
      download_url: null,
      created_at: now(),
      _org: org,
      _query: query,
      _rows: rowCount(org, resource),
    };
    s.exports.push(row);
    return toExport(row);
  });
}

// ─── Imports (owner only) ────────────────────────────────────────────────────

route('GET', '/v1/tenant/imports', (ctx) => {
  requireOwner(ctx, 'tenant.imports.read');
  const { s, org } = seed(ctx);
  const items = s.imports.filter((x) => x._org === org).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return paginate(items.map(toImport), ctx.query);
});

route('GET', '/v1/tenant/imports/:uuid', (ctx) => {
  requireOwner(ctx, 'tenant.imports.read');
  const { s, org } = seed(ctx);
  return toImport(s.imports.find((x) => x.uuid === ctx.params.uuid && x._org === org) ?? (notFound('Import job') as never));
});

route('POST', '/v1/tenant/imports/:uuid/rollback', (ctx) => {
  requireOwner(ctx, 'tenant.imports.read');
  const { s, org } = seed(ctx);
  const row = s.imports.find((x) => x.uuid === ctx.params.uuid && x._org === org) ?? (notFound('Import job') as never);
  if (row.status !== 'applied') fail(409, 'CONFLICT', 'only applied imports can be rolled back');
  if (!row.rollback_until || Date.parse(row.rollback_until) < Date.now()) fail(409, 'CONFLICT', 'rollback window has expired');
  row.status = 'rolled_back';
  row.rollback_until = null;
  return toImport(row);
});
