/**
 * Mock transport: resolves `/v1/*` calls against the in-memory DB with realistic latency,
 * the same envelopes, status codes and error codes as the Go API.
 */
import { ABORTED, setTransport, type Transport } from '@/api/client';
import { ApiError , parseApiError } from '@/api/errors';
import { formatSseEvent } from '@/api/sse';
import { session } from '@/api/session';
import { env } from '@/config/env';
import { createLogger } from '@/lib/logger';

import { fail, matchRoute, MockHttpError, MockSse, normalizeQuery, uuid, type MockCtx } from './core';
import { getDb, loadDb, persist, resetDb } from './db';
import { decodeAccessToken, enforceOrgAccess, permissionsFor } from './handlers/auth';
import { enforcePlan } from './handlers/billing';
import { loadAccessScenario, loadPlanScenario, setAccessScenario, setPlanScenario } from './scenario';
import { seedDb } from './seed';
import { SUCCESS_STATUS } from './status';

import './handlers';

const log = createLogger('mock');
let ready: Promise<unknown> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const boot = () => Promise.all([loadDb(seedDb), loadPlanScenario(), loadAccessScenario()]);

/**
 * Areas whose Go structs mark optional pointer fields `omitempty` (`jobs.Job`, `customers.Customer`,
 * `sales.SaleDetail`, `purchases.Purchase`, `cari.Entry`, …): the API leaves those keys out instead of
 * sending `null`, and the spec types them non-nullable. The demo DB keeps `null`s; they are dropped here.
 */
const OMITEMPTY_ROUTES = /^\/v1\/tenant\/(jobs|customers|customer-vehicles|sales|purchases|suppliers|cari|staff)(\/|$)/;

function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => dropNulls(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) out[k] = dropNulls(v);
    return out;
  }
  return value;
}

function envelope(status: number, data: unknown) {
  return { status, payload: { success: true, data, meta: { request_id: uuid() } } };
}

function errorEnvelope(error: MockHttpError) {
  return {
    status: error.status,
    retryAfter: error.retryAfter,
    payload: {
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
      meta: { request_id: uuid() },
    },
  };
}

async function handle(method: string, path: string, query: MockCtx['query'], body: unknown, headers: Record<string, string>) {
  await (ready ??= boot());
  const match = matchRoute(method, path);
  if (!match) {
    log.warn('No mock route', { method, path });
    return errorEnvelope(new MockHttpError(404, 'NOT_FOUND', `No route for ${method} ${path}`));
  }

  const db = getDb();
  const token = decodeAccessToken(headers.Authorization?.replace(/^Bearer /, ''));
  // A deactivated user's access tokens stop working on the next request (backend identity loader).
  const user = token ? (db.users.find((u) => u.uuid === token.userUuid && !u.deactivatedAt) ?? null) : null;
  const orgUuid = token?.orgUuid ?? null;
  const ctx: MockCtx = {
    method,
    path,
    params: match.params,
    query,
    body: (body ?? {}) as Record<string, unknown>,
    user,
    orgUuid,
    membership: user && orgUuid ? (db.memberships.find((m) => m.userUuid === user.uuid && m.orgUuid === orgUuid) ?? null) : null,
    permissions: user ? permissionsFor(user) : new Set(),
  };

  try {
    if (!match.route.anonymous && !user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
    if (match.route.tenant) {
      if (!orgUuid) fail(403, 'ORGANIZATION_CONTEXT_REQUIRED', 'Organization context required');
      if (!ctx.membership) fail(403, 'NO_TENANT_MEMBERSHIP', 'Not a member of this organization');
      enforceOrgAccess(orgUuid!);
      enforcePlan(ctx);
    }
    const data = await match.route.handler(ctx);
    if (method !== 'GET') persist();
    if (data instanceof MockSse) return { status: 200, payload: undefined, sse: data };
    if (OMITEMPTY_ROUTES.test(path)) return envelope(SUCCESS_STATUS[`${method} ${match.route.path}`] ?? 200, dropNulls(data));
    return envelope(SUCCESS_STATUS[`${method} ${match.route.path}`] ?? 200, data);
  } catch (error) {
    if (error instanceof MockHttpError) return errorEnvelope(error);
    log.error('Mock handler crashed', { method, path, error });
    return errorEnvelope(new MockHttpError(500, 'INTERNAL_ERROR', 'Unexpected server error'));
  }
}

export const mockTransport: Transport = async (req) => {
  await sleep(env.mockLatency * (0.6 + Math.random() * 0.8));
  // Round-trip through JSON so handlers never share object references with the UI cache.
  const body = req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body));
  const res = await handle(req.method, req.path, normalizeQuery(req.query), body, req.headers);
  if ('sse' in res && res.sse) return { status: res.status, payload: undefined, stream: sseBytes(res.sse, req.signal) };
  return { status: res.status, payload: res.payload === undefined ? undefined : JSON.parse(JSON.stringify(res.payload)), retryAfter: 'retryAfter' in res ? res.retryAfter : undefined };
};

/**
 * Serializes a mock SSE answer like the Go handler (`: stream open`, `event:`/`data:` frames, `: ping`)
 * and yields it as UTF-8 bytes in uneven chunks — frames are split mid-way, sometimes inside a multi-byte
 * character — so the app's SSE reader is exercised the same way as on a real network.
 */
async function* sseBytes(answer: MockSse, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const step = Math.min(45, env.mockLatency / 8);
  const check = () => {
    if (signal?.aborted) throw new ApiError({ status: 0, code: ABORTED, message: 'Request cancelled' });
  };
  yield encoder.encode(': stream open\n\n');
  if (answer.thinkMs && env.mockLatency) await sleep(answer.thinkMs);
  for (const [i, ev] of answer.events.entries()) {
    check();
    if (i === 1) yield encoder.encode(': ping\n\n');
    const bytes = encoder.encode(formatSseEvent(ev.event, ev.data));
    const cut = Math.max(1, Math.floor(bytes.length / 2) + (i % 3));
    yield bytes.slice(0, cut);
    if (step) await sleep(step);
    check();
    yield bytes.slice(cut);
  }
}

export function installMockTransport() {
  setTransport(mockTransport);
  ready ??= boot();
  log.info('Mock API installed', { latency: env.mockLatency });
  return ready;
}

/**
 * Multipart uploads in demo mode: accept and delegate to the JSON route with file metadata
 * (`{ uri, name, type }` for file parts). Sends the session token like the live upload does.
 */
export async function mockFormRequest<T>(method: string, path: string, form: FormData): Promise<T> {
  const fields: Record<string, unknown> = {};
  const parts = (form as unknown as { _parts?: [string, unknown][] })._parts;
  if (parts) parts.forEach(([k, v]) => (fields[k] = v));
  else form.forEach((v, k) => (fields[k] = v));
  const token = session.get()?.accessToken;
  const res = await mockTransport({ method, path, body: fields, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status >= 400) throw parseApiError(res.status, res.payload, undefined, res.retryAfter);
  return (res.payload as { data?: T }).data as T;
}

export async function resetMockData() {
  await resetDb(seedDb);
  setPlanScenario('normal');
  setAccessScenario('normal');
  ready = Promise.resolve();
}
