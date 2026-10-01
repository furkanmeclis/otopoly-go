import { env, isMock } from '@/config/env';
import { getCurrentLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

import { ApiError, parseApiError } from './errors';
import { emitApiEvent } from './events';
import { session, type Tokens } from './session';

const log = createLogger('api');

export type Query = Record<string, string | number | boolean | undefined | null>;

export type RequestOptions = {
  query?: Query;
  body?: unknown;
  /** Skip the auth header and 401 refresh (login, refresh, public endpoints). */
  anonymous?: boolean;
  /** Don't emit global error events (toasts / limit dialog); caller handles errors. */
  silent?: boolean;
};

export type TransportRequest = {
  method: string;
  path: string;
  query?: Query;
  body?: unknown;
  headers: Record<string, string>;
};

export type TransportResponse = { status: number; payload: unknown; requestId?: string; /** `Retry-After` seconds (429). */ retryAfter?: number };
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

let requestSeq = 0;

function buildQueryString(query?: Query) {
  if (!query) return '';
  const params: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return params.length ? `?${params.join('&')}` : '';
}

const liveTransport: Transport = async (req) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs);
  try {
    const response = await fetch(`${env.apiUrl}${req.path}${buildQueryString(req.query)}`, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => undefined);
    const retryAfter = Number(response.headers.get('Retry-After'));
    return {
      status: response.status,
      payload,
      requestId: response.headers.get('X-Request-ID') ?? undefined,
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    throw new ApiError({
      status: 0,
      code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: aborted ? 'Request timed out' : 'Network request failed',
    });
  } finally {
    clearTimeout(timer);
  }
};

let transport: Transport = liveTransport;

/** The mock adapter registers itself here in mock mode (see src/api/mock). */
export function setTransport(next: Transport) {
  transport = next;
}

// ─── Token refresh / organization context (single-flight) ─────────────────

let refreshing: Promise<boolean> | null = null;
let switchingOrg: Promise<boolean> | null = null;
let onAuthFailure: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null) {
  onAuthFailure = handler;
}

async function rawCall<T>(method: string, path: string, opts: RequestOptions, headers: Record<string, string>) {
  const res = await transport({ method, path, query: opts.query, body: opts.body, headers });
  const env_ = (res.payload ?? {}) as { success?: boolean; data?: T; meta?: { request_id?: string } };
  return { res, env: env_ };
}

async function refreshTokens(): Promise<boolean> {
  const current = session.get();
  if (!current?.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      log.info('Refreshing access token');
      const { res, env: e } = await rawCall<Tokens>(
        'POST',
        '/v1/auth/refresh',
        { body: { refresh_token: current.refreshToken } },
        baseHeaders(),
      );
      if (res.status >= 400 || !e.data) {
        log.warn('Token refresh rejected', { status: res.status });
        return false;
      }
      await session.setTokens(e.data, current.organizationSlug);
      return true;
    } catch (error) {
      log.error('Token refresh failed', error);
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function ensureOrganizationContext(): Promise<boolean> {
  const current = session.get();
  if (!current?.organizationSlug) return false;
  switchingOrg ??= (async () => {
    try {
      log.info('Re-issuing organization context', { slug: current.organizationSlug });
      const { res, env: e } = await rawCall<Tokens>(
        'POST',
        '/v1/auth/organization-context',
        { body: { organization_slug: current.organizationSlug } },
        { ...baseHeaders(), Authorization: `Bearer ${current.accessToken}` },
      );
      if (res.status >= 400 || !e.data) return false;
      await session.setTokens(e.data, current.organizationSlug);
      return true;
    } catch (error) {
      log.error('Organization context switch failed', error);
      return false;
    } finally {
      setTimeout(() => (switchingOrg = null), 0);
    }
  })();
  return switchingOrg;
}

function baseHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Accept-Language': getCurrentLocale(),
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Calls the Go API (`/v1/...`) and unwraps the `{ success, data, meta }` envelope.
 * Same signature as the web `platformRequest(method, path, { query, body })`.
 * Throws `ApiError` for every non-2xx response and for network failures.
 */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const id = ++requestSeq;
  const started = Date.now();
  const tag = `${method} ${path}`;

  const attempt = async () => {
    const headers = baseHeaders();
    const s = session.get();
    if (!options.anonymous && s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
    return rawCall<T>(method, path, options, headers);
  };

  try {
    let { res, env: e } = await attempt();

    if (!options.anonymous && res.status === 401 && session.get()) {
      if (await refreshTokens()) ({ res, env: e } = await attempt());
      else {
        await session.clear('refresh_failed');
        onAuthFailure?.();
      }
    }

    if (!options.anonymous && res.status === 403) {
      const code = (res.payload as { error?: { code?: string } })?.error?.code;
      if (code === 'ORGANIZATION_CONTEXT_REQUIRED' && (await ensureOrganizationContext())) {
        ({ res, env: e } = await attempt());
      }
    }

    const requestId = e.meta?.request_id ?? res.requestId;
    const ms = Date.now() - started;

    if (res.status >= 200 && res.status < 300) {
      log.debug(`${tag} → ${res.status}`, { id, ms, requestId, mock: isMock });
      return e.data as T;
    }

    const error = parseApiError(res.status, res.payload, requestId, res.retryAfter);
    log.warn(`${tag} → ${res.status} ${error.code}`, { id, ms, requestId, message: error.message, details: error.details });
    if (!options.silent) emitApiEvent(error);
    throw error;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    log.error(`${tag} crashed`, { id, error });
    const wrapped = new ApiError({ status: 0, code: 'NETWORK_ERROR', message: String((error as Error)?.message ?? error) });
    if (!options.silent) emitApiEvent(wrapped);
    throw wrapped;
  }
}

/** Alias kept so services copied from the web frontend compile unchanged. */
export const platformRequest = request;
