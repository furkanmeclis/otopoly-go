/**
 * Runtime configuration from EXPO_PUBLIC_* variables (inlined by Metro at build time).
 *
 *   EXPO_PUBLIC_API_MODE=mock|live   (default: mock until the backend is wired)
 *   EXPO_PUBLIC_API_URL=https://api.otopoly.com   (Go API origin, without /v1)
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=…apps.googleusercontent.com   (Google sign-in; Android Credential Manager)
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=…apps.googleusercontent.com   (Google sign-in on iOS; its reversed form is
 *                                                                  the URL scheme in app.config.js)
 *   EXPO_PUBLIC_WEB_URL=http://192.168.1.5:3000   (optional dev web origin whose /login/qr/* QR codes are accepted)
 */
export type ApiMode = 'mock' | 'live';

const rawMode = process.env.EXPO_PUBLIC_API_MODE;

function hostOf(url: string | undefined) {
  const match = url ? /^https?:\/\/([^/?#]+)/i.exec(url.trim()) : null;
  return match ? match[1].toLowerCase() : null;
}

export const env = {
  apiMode: (rawMode === 'live' ? 'live' : 'mock') as ApiMode,
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  /** Simulated network latency for the mock adapter (ms). */
  mockLatency: Number(process.env.EXPO_PUBLIC_MOCK_LATENCY ?? 350),
  requestTimeoutMs: 20000,
  /** Google OAuth client ids. Native Google sign-in is hidden until they are set. */
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || null,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || null,
  /** Extra web host (host[:port]) accepted by the QR sign-in scanner; production uses otopoly.app. */
  webHost: hostOf(process.env.EXPO_PUBLIC_WEB_URL),
  /** QA only (mock builds): sign in as the demo owner and walk through the main screens. */
  qaTour: process.env.EXPO_PUBLIC_QA_TOUR === '1',
} as const;

export const isMock = env.apiMode === 'mock';
export const qaTourEnabled = isMock && env.qaTour;
