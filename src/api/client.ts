import { env, isMock } from '@/config/env';
import { getCurrentLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

import { ApiError, parseApiError } from './errors';
import { emitApiEvent } from './events';
import { session, type Tokens } from './session';
import { iterateStream, readSse, type SseEvent } from './sse';

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
  /** Server-sent events: a 2xx answer comes back as `stream` instead of a JSON `payload`. */
  stream?: boolean;
  /** Cancels the request (and an open stream). */
  signal?: AbortSignal;
};

export type TransportResponse = {
  status: number;
  payload: unknown;
  requestId?: string;
  /** `Retry-After` seconds (429). */
  retryAfter?: number;
  /** Raw `text/event-stream` body (UTF-8 bytes) of a successful streaming request. */
  stream?: AsyncIterable<Uint8Array>;
};
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

/** Error code of a streaming request the caller cancelled (stop button, screen closed). */
export const ABORTED = 'ABORTED';
const abortedError = () => new ApiError({ status: 0, code: ABORTED, message: 'Request cancelled' });
export const isAborted = (error: unknown) => error instanceof ApiError && error.code === ABORTED;
/** The Go API sends `: ping` every 15 s; a stream silent for this long is treated as dropped. */
const STREAM_IDLE_MS = 45_000;

type StreamBody = { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(): Promise<void> } };

/**
 * Streaming POST for SSE endpoints. SDK 57 installs `expo/fetch` as the global `fetch` on iOS/Android; its
 * `response.body` is a WHATWG ReadableStream, so events arrive as the server flushes them. If the runtime
 * has no streaming body (e.g. `EXPO_PUBLIC_USE_RN_FETCH=1`), the whole body is read once it ends instead:
 * same events, just no incremental rendering.
 */
async function liveStream(req: TransportRequest): Promise<TransportResponse> {
  if (req.signal?.aborted) throw abortedError();
  const controller = new AbortController();
  const forward = () => controller.abort();
  req.signal?.addEventListener('abort', forward);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  const cleanup = () => {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', forward);
  };
  const mapError = (error: unknown) => {
    if (error instanceof ApiError) return error;
    if (req.signal?.aborted) return abortedError();
    return new ApiError({ status: 0, code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', message: timedOut ? 'Request timed out' : 'Network request failed' });
  };

  let response: Response;
  try {
    arm(env.requestTimeoutMs);
    response = await fetch(`${env.apiUrl}${req.path}${buildQueryString(req.query)}`, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    throw mapError(error);
  }
  const requestId = response.headers.get('X-Request-ID') ?? undefined;
  const isStream = /text\/event-stream/i.test(response.headers.get('Content-Type') ?? '');
  if (!response.ok || !isStream) {
    // Errors are regular JSON envelopes: availability, quota, validation are checked before the stream opens.
    try {
      const payload = await response.json().catch(() => undefined);
      const retryAfter = Number(response.headers.get('Retry-After'));
      return { status: response.status, payload, requestId, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined };
    } catch (error) {
      throw mapError(error);
    } finally {
      cleanup();
    }
  }

  const body = response.body as unknown as Partial<StreamBody> | null;
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      if (body && typeof body.getReader === 'function') {
        arm(STREAM_IDLE_MS);
        for await (const chunk of iterateStream(body as StreamBody)) {
          arm(STREAM_IDLE_MS);
          yield chunk;
        }
      } else {
        clearTimeout(timer);
        yield new TextEncoder().encode(await response.text());
      }
    } catch (error) {
      throw mapError(error);
    } finally {
      cleanup();
    }
  }
  return { status: response.status, payload: undefined, requestId, stream: chunks() };
}

const liveTransport: Transport = async (req) => {
  if (req.stream) return liveStream(req);
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

async function rawCall<T>(method: string, path: string, opts: RequestOptions, headers: Record<string, string>, extra: Pick<TransportRequest, 'stream' | 'signal'> = {}) {
  const res = await transport({ method, path, query: opts.query, body: opts.body, headers, ...extra });
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

/**
 * Sends a request with the session token; refreshes an expired access token and re-issues the
 * organization context once (single-flight). Shared by JSON calls and SSE streams.
 */
async function exchange<T>(method: string, path: string, options: RequestOptions, extra: Pick<TransportRequest, 'stream' | 'signal'> = {}) {
  const attempt = async () => {
    const headers = baseHeaders();
    if (extra.stream) headers.Accept = 'text/event-stream';
    const s = session.get();
    if (!options.anonymous && s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
    return rawCall<T>(method, path, options, headers, extra);
  };

  let { res, env: e } = await attempt();

  // Only an expired/invalid access token is worth a refresh; 401 INVALID_CREDENTIALS (wrong current
  // password), INVALID_MFA_CODE etc. are answers about the request itself.
  const code401 = res.status === 401 ? (res.payload as { error?: { code?: string } })?.error?.code : undefined;
  if (!options.anonymous && res.status === 401 && (!code401 || code401 === 'UNAUTHENTICATED') && session.get()) {
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
  return { res, env: e, requestId: e.meta?.request_id ?? res.requestId };
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

  try {
    const { res, env: e, requestId } = await exchange<T>(method, path, options);
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

export type StreamOptions = Omit<RequestOptions, 'query'> & {
  /** Called for every server-sent event, in order, as it arrives. */
  onEvent: (event: SseEvent) => void;
  /** Aborting closes the stream; the promise then rejects with code `ABORTED` (see `isAborted`). */
  signal?: AbortSignal;
};

/**
 * POSTs to a server-sent-events endpoint (AI chat, AI action confirm) and dispatches its events as they
 * arrive. Failures before the stream opens (validation, quota, 401 → refresh + retry, 403 organization
 * context) behave like `request`. Resolves when the server closes the stream.
 */
export async function requestStream(method: string, path: string, options: StreamOptions): Promise<void> {
  const id = ++requestSeq;
  const started = Date.now();
  const tag = `${method} ${path} (stream)`;
  const { signal, onEvent } = options;
  try {
    const { res, requestId } = await exchange(method, path, options, { stream: true, signal });
    if (res.status >= 200 && res.status < 300 && res.stream) {
      let events = 0;
      await readSse(res.stream, (ev) => {
        if (signal?.aborted) return;
        events++;
        onEvent(ev);
      });
      if (signal?.aborted) throw abortedError();
      log.debug(`${tag} → ${res.status}`, { id, ms: Date.now() - started, requestId, events, mock: isMock });
      return;
    }
    const error =
      res.status >= 200 && res.status < 300
        ? new ApiError({ status: res.status, code: 'NETWORK_ERROR', message: 'Expected an event stream', requestId })
        : parseApiError(res.status, res.payload, requestId, res.retryAfter);
    log.warn(`${tag} → ${res.status} ${error.code}`, { id, requestId, message: error.message, details: error.details });
    if (!options.silent) emitApiEvent(error);
    throw error;
  } catch (error) {
    if (signal?.aborted) throw abortedError();
    if (error instanceof ApiError) throw error;
    log.error(`${tag} crashed`, { id, error });
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: String((error as Error)?.message ?? error) });
  }
}

/** Alias kept so services copied from the web frontend compile unchanged. */
export const platformRequest = request;
