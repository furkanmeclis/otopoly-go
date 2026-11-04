/**
 * Sentry (self-hosted, Sentry-protocol tracker) wiring. Only imported by the root layout.
 *
 * - No `EXPO_PUBLIC_SENTRY_DSN` → nothing is initialised (dev, mock and CI builds work without it).
 * - environment = `appEnv`; release / dist come from the native SDK (`<bundle id>@<version>+<build>`),
 *   so the Xcode Cloud / EAS build number is always the real one.
 * - No personal data: `sendDefaultPii: false`, user = opaque id, and `beforeSend` / `beforeBreadcrumb`
 *   scrub e-mails, phone numbers, tokens, URL query strings and request data again.
 * - Mock mode (incl. the QA tour): API failures are simulated, so none of them are reported.
 * See docs/SENTRY.md.
 */
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent, TransactionEvent } from '@sentry/react-native';

import { appEnv, env, isMock } from '@/config/env';

import { installMonitoringReporter, normalizeEndpoint, scrubText, scrubValue, type ApiFailure } from './index';

export const sentryEnabled = !!env.sentryDsn;

/** Screen names for performance traces (route names, never params). Registered in the root layout. */
export const navigationIntegration = Sentry.reactNavigationIntegration();

const TRACES_SAMPLE_RATE: Record<typeof appEnv, number> = { production: 0.2, preview: 0.5, development: 1 };
/** Relative to sampled traces: production profiles ~2% of sessions. */
const PROFILES_SAMPLE_RATE: Record<typeof appEnv, number> = { production: 0.1, preview: 0.3, development: 0 };

function scrubUrl(url: unknown) {
  if (typeof url !== 'string') return url;
  const origin = /^https?:\/\/[^/?#]+/i.exec(url)?.[0] ?? '';
  return `${origin}${normalizeEndpoint(url)}`;
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  const category = crumb.category ?? '';
  // Touch labels can carry on-screen text (customer names, plates); console args can carry anything.
  if (category === 'touch' || category.startsWith('ui.') || category === 'console') return null;
  if (crumb.type === 'http' || category === 'fetch' || category === 'xhr') {
    const data = crumb.data ?? {};
    return { ...crumb, message: undefined, data: { method: data.method, status_code: data.status_code, url: scrubUrl(data.url) } };
  }
  return {
    ...crumb,
    message: crumb.message ? scrubText(crumb.message) : crumb.message,
    data: crumb.data ? (scrubValue(crumb.data) as Breadcrumb['data']) : crumb.data,
  };
}

function scrubCommon<T extends ErrorEvent | TransactionEvent>(event: T): T {
  event.user = event.user?.id ? { id: event.user.id } : undefined;
  delete event.server_name;
  if (event.contexts?.device) delete (event.contexts.device as Record<string, unknown>).name;
  if (event.request) event.request = { url: scrubUrl(event.request.url) as string | undefined };
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.message) event.message = scrubText(event.message);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  return event;
}

function beforeSend(event: ErrorEvent): ErrorEvent | null {
  scrubCommon(event);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  return event;
}

function beforeSendTransaction(event: TransactionEvent): TransactionEvent | null {
  scrubCommon(event);
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubText(span.description);
    if (span.data) {
      for (const key of Object.keys(span.data)) {
        const v = span.data[key];
        if (/query|fragment/i.test(key)) delete span.data[key];
        else if (typeof v === 'string') span.data[key] = /url/i.test(key) ? (scrubUrl(v) as string) : scrubText(v);
      }
    }
  }
  return event;
}

// The same endpoint failing in a loop (offline, outage) is reported once a minute, not per request.
const API_REPORT_INTERVAL_MS = 60_000;
const lastApiReport = new Map<string, number>();

function captureApiFailure(failure: ApiFailure) {
  if (isMock) return;
  const endpoint = normalizeEndpoint(failure.path);
  const key = `${failure.method} ${endpoint} ${failure.status || failure.code}`;
  const now = Date.now();
  if (now - (lastApiReport.get(key) ?? 0) < API_REPORT_INTERVAL_MS) return;
  lastApiReport.set(key, now);
  Sentry.withScope((scope) => {
    scope.setLevel(failure.status >= 500 ? 'error' : 'warning');
    scope.setTags({
      'api.endpoint': endpoint,
      'api.method': failure.method,
      'api.status': String(failure.status),
      'api.code': failure.code,
      'api.stream': failure.stream ? 'true' : 'false',
    });
    if (failure.requestId) scope.setTag('api.request_id', failure.requestId);
    scope.setFingerprint(['api-failure', failure.method, endpoint, String(failure.status || failure.code)]);
    Sentry.captureMessage(`API ${failure.method} ${endpoint} → ${failure.status || failure.code}`);
  });
}

export function initSentry() {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: env.sentryDsn!,
    environment: appEnv,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Our own reporting covers API failures (with scrubbed tags); never attach request data.
    enableCaptureFailedRequests: false,
    // Leave API requests untouched (no sentry-trace / baggage headers).
    tracePropagationTargets: [],
    tracesSampleRate: TRACES_SAMPLE_RATE[appEnv],
    profilesSampleRate: PROFILES_SAMPLE_RATE[appEnv],
    enableAutoPerformanceTracing: true,
    enableAppStartTracking: true,
    enableNativeFramesTracking: true,
    enableStallTracking: true,
    enableUserInteractionTracing: false,
    integrations: [navigationIntegration],
    beforeSend,
    beforeSendTransaction,
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    // iOS: native NSURLSession breadcrumbs would keep full URLs (query strings) on native crash reports.
    ...({ enableNetworkBreadcrumbs: false } as object),
  });
  Sentry.setTag('api_mode', env.apiMode);

  installMonitoringReporter({
    captureError: (error, context) => {
      Sentry.withScope((scope) => {
        if (context?.tags) scope.setTags(context.tags);
        Sentry.captureException(error);
      });
    },
    captureApiFailure,
    setUser: (id) => Sentry.setUser(id ? { id } : null),
  });
}

export { Sentry };
