/** Error codes the app branches on (backend `error.code`, see API_CONVENTIONS.md). */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LIMIT_REACHED'
  | 'FEATURE_DISABLED'
  | 'ORGANIZATION_CONTEXT_REQUIRED'
  | 'NO_TENANT_MEMBERSHIP'
  | 'ORGANIZATION_ACCESS_EXPIRED'
  | 'SUBSCRIPTION_READ_ONLY'
  | 'MFA_REQUIRED'
  | 'TOTP_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'STEP_UP_REQUIRED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL'
  | 'INTERNAL_ERROR'
  | (string & {});

export type ApiErrorDetail = { field?: string; message: string; code?: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;
  /** Extra payload (e.g. LIMIT_REACHED feature/limit/used). */
  readonly extra?: Record<string, unknown>;
  /** Seconds from the `Retry-After` header (429 RATE_LIMITED). */
  readonly retryAfter?: number;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
    extra?: Record<string, unknown>;
    retryAfter?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
    this.extra = init.extra;
    this.retryAfter = init.retryAfter;
  }

  /** Field → message map for forms. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) if (d.field && !out[d.field]) out[d.field] = d.message;
    return out;
  }

  get isNetwork() {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

type ErrorEnvelope = {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[] | Record<string, unknown>;
  };
  meta?: { request_id?: string };
};

export function parseApiError(status: number, payload: unknown, requestId?: string, retryAfter?: number): ApiError {
  const env = (payload ?? {}) as ErrorEnvelope;
  const details = env.error?.details;
  return new ApiError({
    status,
    code: env.error?.code ?? (status >= 500 ? 'INTERNAL' : status === 404 ? 'NOT_FOUND' : 'UNKNOWN'),
    message: env.error?.message ?? `HTTP ${status}`,
    details: Array.isArray(details) ? details : [],
    extra: details && !Array.isArray(details) ? details : undefined,
    requestId: env.meta?.request_id ?? requestId,
    retryAfter,
  });
}

// ─── Plan limits ───────────────────────────────────────────────────────────

/** Numbers a `409 LIMIT_REACHED` carries (backend `middleware.WriteLimitReached`). */
export type LimitInfo = { feature?: string; limit?: number; used?: number; tolerance?: number };

const toNum = (v: unknown) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Reads `feature` / `limit` / `used` / `tolerance` from a limit error. The Go API sends them as a
 * details list (`[{ field: "feature", message: "jobs.daily" }, …]`); an object payload is accepted too.
 */
export function limitInfo(error: ApiError): LimitInfo {
  const map: Record<string, unknown> = { ...(error.extra ?? {}) };
  for (const d of error.details) if (d.field && d.message !== undefined) map[d.field] = d.message;
  return {
    feature: typeof map.feature === 'string' && map.feature ? map.feature : undefined,
    limit: toNum(map.limit),
    used: toNum(map.used),
    tolerance: toNum(map.tolerance),
  };
}

/** `details` list (`[{ field, message }]`) or object payload → flat string map. */
export function detailMap(error: ApiError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(error.extra ?? {})) if (v !== undefined && v !== null) map[k] = String(v);
  for (const d of error.details) if (d.field && d.message !== undefined) map[d.field] = String(d.message);
  return map;
}

/** `409 LIMIT_REACHED`: a hard plan limit is exhausted. */
export const isLimitReached = (error: unknown): error is ApiError => isApiError(error) && error.code === 'LIMIT_REACHED';

/** `403 FEATURE_DISABLED`: the organization's plan turns the module off. */
export const isFeatureDisabled = (error: unknown): error is ApiError => isApiError(error) && error.code === 'FEATURE_DISABLED';

/** `403 SUBSCRIPTION_READ_ONLY`: the plan period ended; reads work, writes don't. */
export const isReadOnly = (error: unknown): error is ApiError => isApiError(error) && error.code === 'SUBSCRIPTION_READ_ONLY';

/** Plan blocks that get the shared plan dialog instead of an error toast. */
export const isPlanBlocked = (error: unknown): error is ApiError => isLimitReached(error) || isReadOnly(error);
