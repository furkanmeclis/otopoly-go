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

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
    extra?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
    this.extra = init.extra;
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

export function parseApiError(status: number, payload: unknown, requestId?: string): ApiError {
  const env = (payload ?? {}) as ErrorEnvelope;
  const details = env.error?.details;
  return new ApiError({
    status,
    code: env.error?.code ?? (status >= 500 ? 'INTERNAL' : status === 404 ? 'NOT_FOUND' : 'UNKNOWN'),
    message: env.error?.message ?? `HTTP ${status}`,
    details: Array.isArray(details) ? details : [],
    extra: details && !Array.isArray(details) ? details : undefined,
    requestId: env.meta?.request_id ?? requestId,
  });
}
