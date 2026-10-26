/**
 * Mock API core: routing, envelopes, pagination and permission checks.
 * Handlers mirror the Go API contract (backend/API_CONVENTIONS.md) so switching to
 * EXPO_PUBLIC_API_MODE=live needs no screen changes.
 */
import type { Query } from '@/api/client';

export type MockUser = {
  uuid: string;
  email: string;
  password: string;
  name: string;
  surname: string;
  locale: string;
  status: 'active' | 'inactive';
  roles: string[];
  totpEnabled: boolean;
  created_at: string;
  /** Set by account deletion (`/v1/auth/account/deactivate`): every sign-in answers ACCOUNT_DEACTIVATED. */
  deactivatedAt?: string | null;
  isSuperAdmin?: boolean;
};

export type MockMembership = {
  userUuid: string;
  orgUuid: string;
  role: 'owner' | 'staff';
};

export type MockCtx = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  /** Authenticated user (null for anonymous routes). */
  user: MockUser | null;
  /** Active organization from the token (`oid`). */
  orgUuid: string | null;
  membership: MockMembership | null;
  permissions: Set<string>;
};

export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** `Retry-After` seconds for 429 responses. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const fail = (status: number, code: string, message: string, details?: unknown): never => {
  throw new MockHttpError(status, code, message, details);
};

export const notFound = (what = 'Resource'): never => fail(404, 'NOT_FOUND', `${what} not found`);

export function validation(details: { field: string; message: string; code?: string }[]): never {
  return fail(400, 'VALIDATION_ERROR', 'Validation failed', details.map((d) => ({ code: 'invalid', ...d })));
}

/** Throws VALIDATION_ERROR listing every missing required field. */
export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter((f) => {
    const v = body[f];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length) validation(missing.map((field) => ({ field, message: 'required', code: 'required' })));
}

export type Handler = (ctx: MockCtx) => unknown | Promise<unknown>;

/**
 * A `text/event-stream` answer (AI chat / action confirm). The mock transport serializes the events
 * exactly like the Go `sseWriter` and streams them with a small delay, so mock and live share the
 * app's SSE reader. `thinkMs` delays the first event (the "thinking…" state).
 */
export class MockSse {
  constructor(
    readonly events: { event: string; data: unknown }[],
    readonly thinkMs = 0,
  ) {}
}

export const sse = (events: MockSse['events'], thinkMs = 0) => new MockSse(events, thinkMs);

type RouteDef = {
  method: string;
  /** Registered path template (`/v1/tenant/jobs/:uuid`). */
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  anonymous: boolean;
  tenant: boolean;
};

const routes: RouteDef[] = [];

function compile(path: string) {
  const keys: string[] = [];
  const source = path.replace(/\/:([a-zA-Z_]+)/g, (_, k: string) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

/**
 * Registers a route. Static segments must be registered before `:param` ones on the same prefix
 * (same rule as the Go ServeMux: `/meta` before `/{uuid}`) — first match wins.
 */
export function route(method: string, path: string, handler: Handler, opts: { anonymous?: boolean } = {}) {
  const { pattern, keys } = compile(path);
  routes.push({
    method,
    path,
    pattern,
    keys,
    handler,
    anonymous: Boolean(opts.anonymous),
    tenant: path.startsWith('/v1/tenant/'),
  });
}

/** Every registered mock route (contract test coverage). */
export function listRoutes() {
  return routes.map((r) => ({ method: r.method, path: r.path, anonymous: r.anonymous }));
}

export function matchRoute(method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route: r, params };
  }
  return null;
}

export function normalizeQuery(query?: Query): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
}

// ─── Permissions ───────────────────────────────────────────────────────────

export function requirePerm(ctx: MockCtx, permission: string) {
  if (!ctx.permissions.has(permission)) fail(403, 'FORBIDDEN', `Missing permission ${permission}`);
}

/** Owner-membership gate used by the backend for voids and owner-only writes. */
export function requireOwner(ctx: MockCtx, permission?: string) {
  if (permission) requirePerm(ctx, permission);
  if (ctx.membership?.role !== 'owner') fail(403, 'FORBIDDEN', 'Only the organization owner can do this');
}

// ─── Resource meta ─────────────────────────────────────────────────────────

const CAPABILITY_KEYS = ['create', 'read', 'update', 'delete', 'search', 'filter', 'sort', 'export', 'import', 'bulk'] as const;

/**
 * `GET …/meta` payload in the backend `resourcemeta.ResourceMeta` shape: every key is always present
 * (empty arrays, all ten capability flags), `resource` is the backend id (`tenant.jobs`).
 */
export function resourceMeta(resource: string, defaultSort: string, capabilities: Partial<Record<(typeof CAPABILITY_KEYS)[number], boolean>>, fields: { searchable?: string[]; sortable?: string[]; filterable?: string[] } = {}) {
  return {
    resource,
    default_sort: defaultSort,
    default_fields: [] as string[],
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, Boolean(capabilities[k])])),
    searchable_fields: fields.searchable ?? [],
    sortable_fields: fields.sortable ?? [],
    filterable_fields: fields.filterable ?? [],
    columns: [] as unknown[],
    filters: [] as unknown[],
    includes: [] as string[],
    bulk_actions: [] as string[],
  };
}

// ─── Lists ─────────────────────────────────────────────────────────────────

const LIST_MAX = 100;

export function paginate<T>(items: T[], query: Record<string, string>, defaultLimit = 20) {
  const limit = Math.min(Math.max(Number(query.limit ?? defaultLimit) || defaultLimit, 1), LIST_MAX);
  const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

function trNormalize(s: string) {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '');
}

/** `q` search over the given fields (Turkish-insensitive, whitespace-insensitive for plates). */
export function search<T>(items: T[], q: string | undefined, fields: (keyof T | ((item: T) => string))[]) {
  if (!q?.trim()) return items;
  const needle = trNormalize(q);
  return items.filter((item) =>
    fields.some((f) => {
      const v = typeof f === 'function' ? f(item) : item[f];
      return v != null && trNormalize(String(v)).includes(needle);
    }),
  );
}

/** `sort=-created_at,name` */
export function sortBy<T>(items: T[], sort: string | undefined, fallback = '-created_at') {
  const spec = (sort || fallback).split(',').filter(Boolean);
  return [...items].sort((a, b) => {
    for (const s of spec) {
      const desc = s.startsWith('-');
      const key = (desc ? s.slice(1) : s) as keyof T;
      const av = a[key] as unknown;
      const bv = b[key] as unknown;
      if (av === bv) continue;
      const an = typeof av === 'string' && /^-?\d+(\.\d+)?$/.test(av) ? Number(av) : av;
      const bn = typeof bv === 'string' && /^-?\d+(\.\d+)?$/.test(bv) ? Number(bv) : bv;
      const cmp = (an ?? '') < (bn ?? '') ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

// ─── Values ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optional uuid query filter (`customer_uuid`, …): absent → undefined, malformed → 400 like the Go handlers. */
export function uuidQuery(ctx: MockCtx, name: string): string | undefined {
  const raw = (ctx.query[name] ?? '').trim();
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) fail(400, 'VALIDATION_ERROR', `${name} is invalid`, [{ field: name, message: 'invalid uuid', code: 'invalid' }]);
  return raw;
}

/** Stable uuid-shaped id from a string (derived rows such as activity entries keep their id across pages). */
export function stableUuid(seed: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < seed.length; i++) {
      const c = seed.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ (c + h1), 2246822507) >>> 0;
    }
    hex.push(((h1 ^ h2) >>> 0).toString(16).padStart(8, '0'));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${((parseInt(s[16], 16) & 0x3) | 0x8).toString(16)}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Drops `null` values of the given keys — Go `*T ... json:",omitempty"` fields are absent, never `null`. */
export function omitNulls<T extends object>(obj: T, keys: readonly (keyof T)[]): T {
  const out = { ...obj };
  for (const k of keys) if (out[k] === null) delete out[k];
  return out;
}

export const now = () => new Date().toISOString();
export const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));
export const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback);

/** Istanbul calendar day (yyyy-MM-dd) — the backend buckets days in Europe/Istanbul. */
export function istanbulDay(d: Date | string = new Date()) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function inDayRange(iso: string | null | undefined, from?: string, to?: string) {
  if (!iso) return false;
  const day = istanbulDay(iso);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
