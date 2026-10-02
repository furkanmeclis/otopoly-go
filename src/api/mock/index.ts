/**
 * Mock transport: resolves `/v1/*` calls against the in-memory DB with realistic latency,
 * the same envelopes, status codes and error codes as the Go API.
 */
import { setTransport, type Transport } from '@/api/client';
import { env } from '@/config/env';
import { createLogger } from '@/lib/logger';

import { fail, matchRoute, MockHttpError, normalizeQuery, uuid, type MockCtx } from './core';
import { getDb, loadDb, persist, resetDb } from './db';
import { decodeAccessToken, enforceOrgAccess, permissionsFor } from './handlers/auth';
import { enforcePlan } from './handlers/billing';
import { loadAccessScenario, loadPlanScenario, setAccessScenario, setPlanScenario } from './scenario';
import { seedDb } from './seed';

import './handlers';

const log = createLogger('mock');
let ready: Promise<unknown> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const boot = () => Promise.all([loadDb(seedDb), loadPlanScenario(), loadAccessScenario()]);

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
    return envelope(method === 'POST' && /\/(jobs|customers|sales|purchases|suppliers|leads|quotes|todos|staff)$/.test(path) ? 201 : 200, data);
  } catch (error) {
    if (error instanceof MockHttpError) return errorEnvelope(error);
    log.error('Mock handler crashed', { method, path, error });
    return errorEnvelope(new MockHttpError(500, 'INTERNAL', 'Internal server error'));
  }
}

export const mockTransport: Transport = async (req) => {
  await sleep(env.mockLatency * (0.6 + Math.random() * 0.8));
  // Round-trip through JSON so handlers never share object references with the UI cache.
  const body = req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body));
  const res = await handle(req.method, req.path, normalizeQuery(req.query), body, req.headers);
  return { status: res.status, payload: JSON.parse(JSON.stringify(res.payload)), retryAfter: 'retryAfter' in res ? res.retryAfter : undefined };
};

export function installMockTransport() {
  setTransport(mockTransport);
  ready ??= boot();
  log.info('Mock API installed', { latency: env.mockLatency });
  return ready;
}

/** Multipart uploads in demo mode: accept and delegate to the JSON route with file metadata. */
export async function mockFormRequest<T>(method: string, path: string, form: FormData): Promise<T> {
  const fields: Record<string, unknown> = {};
  (form as unknown as { _parts?: [string, unknown][] })._parts?.forEach(([k, v]) => (fields[k] = v));
  const res = await mockTransport({ method, path, body: fields, headers: {} });
  const payload = res.payload as { data?: T; error?: { message?: string } };
  if (res.status >= 400) throw new Error(payload.error?.message ?? 'Upload failed');
  return payload.data as T;
}

export async function resetMockData() {
  await resetDb(seedDb);
  setPlanScenario('normal');
  setAccessScenario('normal');
  ready = Promise.resolve();
}
