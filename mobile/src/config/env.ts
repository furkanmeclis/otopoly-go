/**
 * Runtime configuration from EXPO_PUBLIC_* variables (inlined by Metro at build time).
 *
 *   EXPO_PUBLIC_API_MODE=mock|live   (default: mock until the backend is wired)
 *   EXPO_PUBLIC_API_URL=https://api.otopoly.com   (Go API origin, without /v1)
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=…apps.googleusercontent.com   (Google sign-in; Android Credential Manager)
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=…apps.googleusercontent.com   (Google sign-in on iOS; its reversed form is
 *                                                                  the URL scheme in app.config.js)
 *   EXPO_PUBLIC_WEB_URL=http://192.168.1.5:3000   (optional dev web origin whose /login/qr/* QR codes are accepted)
 *   EXPO_PUBLIC_APP_ENV=development|preview|production   (production = App Store / Play Store build)
 *   EXPO_PUBLIC_PRIVACY_URL=https://otopoly.app/privacy   (privacy policy; login, profile, AI consent, account deletion)
 *   EXPO_PUBLIC_TERMS_URL=https://otopoly.app/terms       (terms of use)
 *   EXPO_PUBLIC_ACCOUNT_DELETE_URL=https://otopoly.app/account/delete   (web deletion + 30-day recovery page)
 *   EXPO_PUBLIC_REALTIME=off                (live list updates over Centrifugo; on by default, fail-soft)
 *   EXPO_PUBLIC_SENTRY_DSN=https://<key>@<host>/<project>  (error / performance reporting, see docs/SENTRY.md;
 *                                                         unset → Sentry is not initialised at all)
 *
 * Store builds (`EXPO_PUBLIC_APP_ENV=production`) never run the in-app mock: demo accounts, the demo
 * sign-in deep link, the QA tour, demo pickers and the diagnostics screen are compiled out of reach.
 * app.config.js refuses a production config that asks for mock mode or the QA tour.
 */
export type ApiMode = 'mock' | 'live';
export type AppEnv = 'development' | 'preview' | 'production';

const rawMode = process.env.EXPO_PUBLIC_API_MODE;
const rawAppEnv = process.env.EXPO_PUBLIC_APP_ENV;

/** Unset → `development` in dev (Metro) builds, `preview` in other release builds (TestFlight demos). */
export const appEnv: AppEnv =
  rawAppEnv === 'production' || rawAppEnv === 'preview' || rawAppEnv === 'development' ? rawAppEnv : __DEV__ ? 'development' : 'preview';
/** App Store / Google Play build: no mock, demo, QA or diagnostics code paths. */
export const isStoreBuild = appEnv === 'production';

const DEFAULT_LIVE_API_URL = 'https://api.otopoly.app';

function urlOr(value: string | undefined, fallback: string) {
  const v = value?.trim();
  return v && /^https:\/\//i.test(v) ? v : fallback;
}

function hostOf(url: string | undefined) {
  const match = url ? /^https?:\/\/([^/?#]+)/i.exec(url.trim()) : null;
  return match ? match[1].toLowerCase() : null;
}

export const env = {
  apiMode: (isStoreBuild || rawMode === 'live' ? 'live' : 'mock') as ApiMode,
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? (isStoreBuild ? DEFAULT_LIVE_API_URL : 'http://localhost:8080')).replace(/\/$/, ''),
  /** Simulated network latency for the mock adapter (ms). */
  mockLatency: Number(process.env.EXPO_PUBLIC_MOCK_LATENCY ?? 350),
  requestTimeoutMs: 20000,
  /** Google OAuth client ids. Native Google sign-in is hidden until they are set. */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || null,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || null,
  /** Extra web host (host[:port]) accepted by the QR sign-in scanner (dev only); store builds accept otopoly.app only. */
  webHost: isStoreBuild ? null : hostOf(process.env.EXPO_PUBLIC_WEB_URL),
  /** QA only (mock builds): sign in as the demo owner and walk through the main screens. */
  qaTour: !isStoreBuild && process.env.EXPO_PUBLIC_QA_TOUR === '1',
  /** Public legal pages (must be reachable without signing in). */
  privacyUrl: urlOr(process.env.EXPO_PUBLIC_PRIVACY_URL, 'https://otopoly.app/privacy'),
  termsUrl: urlOr(process.env.EXPO_PUBLIC_TERMS_URL, 'https://otopoly.app/terms'),
  /** Public account deletion / recovery page (TR; the EN page is `/en/account/delete`). Unset → otopoly.app. */
  accountDeleteUrl: urlOr(process.env.EXPO_PUBLIC_ACCOUNT_DELETE_URL, 'https://otopoly.app/account/delete'),
  /** Sentry-protocol DSN (self-hosted tracker). Null → no error reporting. */
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || null,
  /** Live list updates (Centrifugo). The app works the same without them. */
  realtimeEnabled: process.env.EXPO_PUBLIC_REALTIME !== 'off',
} as const;

export const isMock = env.apiMode === 'mock';
export const qaTourEnabled = isMock && env.qaTour;
/** Diagnostics screen (logs, demo scenarios): development and preview builds only. */
export const devToolsEnabled = !isStoreBuild;
