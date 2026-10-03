/**
 * SDK-free monitoring facade. App code (API client, auth, error boundaries) reports through here, so it
 * never imports `@sentry/react-native` directly and still runs where the SDK can't (Node smoke tests,
 * builds without a DSN). `./sentry.ts` plugs the real reporter in at startup when a DSN is configured;
 * until then every call is a no-op.
 *
 * Privacy: only opaque ids, normalised endpoints and status codes leave the device. Bodies, headers,
 * tokens, e-mails and phone numbers are never attached and are scrubbed again in `beforeSend`.
 */

export type ApiFailure = {
  method: string;
  /** Request path as called (`/v1/jobs/123?q=…`); normalised before it is sent. */
  path: string;
  status: number;
  code: string;
  requestId?: string;
  stream?: boolean;
};

export type MonitoringReporter = {
  captureError: (error: unknown, context?: { tags?: Record<string, string> }) => void;
  captureApiFailure: (failure: ApiFailure) => void;
  setUser: (id: string | null) => void;
};

let reporter: MonitoringReporter | null = null;

export function installMonitoringReporter(next: MonitoringReporter) {
  reporter = next;
}

export function captureError(error: unknown, context?: { tags?: Record<string, string> }) {
  try {
    reporter?.captureError(error, context);
  } catch {
    // Reporting must never break the app.
  }
}

/**
 * Unexpected API failures only: 5xx and transport failures (network, timeout). Expected 4xx answers
 * (validation, 401 refresh flow, LIMIT_REACHED, …) and cancelled streams are never reported.
 */
export function isReportableApiFailure(status: number, code: string) {
  if (status >= 500) return true;
  return status === 0 && (code === 'NETWORK_ERROR' || code === 'TIMEOUT');
}

export function reportApiFailure(failure: ApiFailure) {
  if (!reporter || !isReportableApiFailure(failure.status, failure.code)) return;
  try {
    reporter.captureApiFailure(failure);
  } catch {
    // ignore
  }
}

export function setMonitoringUser(id: string | null) {
  try {
    reporter?.setUser(id);
  } catch {
    // ignore
  }
}

// ─── Scrubbing (pure helpers, shared with ./sentry.ts and the smoke tests) ───────────────────────────

const SEGMENT_OK = /^(v\d+|[a-z][a-z_-]*)$/;

/**
 * `/v1/jobs/8f1c…/photos?page=2` → `/v1/jobs/:id/photos`. Drops the query string and origin and replaces
 * every segment that is not a plain lowercase word (ids, uuids, slugs with digits, tokens, e-mails) with `:id`.
 */
export function normalizeEndpoint(pathOrUrl: string) {
  let path = pathOrUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  path = path.split(/[?#]/)[0] ?? '';
  const segments = path.split('/').map((seg) => (seg === '' || SEGMENT_OK.test(seg) ? seg : ':id'));
  return segments.join('/') || '/';
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
// +90 555 123 45 67, 0555 123 4567, (555) 123-4567 …: 10+ digits with optional separators.
const PHONE = /(?:\+?\d[\s().-]?){9,}\d/g;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>]+/gi;

/** Removes e-mails, phone numbers, bearer / JWT tokens and URL query strings from free text. */
export function scrubText(text: string) {
  return text
    .replace(URL_IN_TEXT, (url) => {
      const origin = /^https?:\/\/[^/?#]+/i.exec(url)?.[0] ?? '';
      return `${origin}${normalizeEndpoint(url)}`;
    })
    .replace(BEARER, '$1 [redacted]')
    .replace(JWT, '[jwt]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]');
}

const SENSITIVE_KEY =
  /pass(word)?|token|secret|authorization|cookie|otp|code_verifier|refresh|e-?mail|phone|gsm|surname|full_?name|address|tckn|iban|plate|body|payload|params|query|headers?|^name$/i;

/** Deep copy with sensitive keys dropped and every string scrubbed. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}
