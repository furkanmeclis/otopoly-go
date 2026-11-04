import { request } from '@/api/client';

/**
 * QR sign-in (Go API `/v1/auth/qr/*`, otopoly-go `feat/qr-login`). The web login page shows a QR for
 * `https://otopoly.app/login/qr/{session_id}`; the signed-in app loads the details and approves or rejects.
 * The approval signs the browser tab in as this user, scoped to the app's active organization.
 */
export type QRLoginStatus = 'pending' | 'approved' | 'rejected';

export type QRLoginLocation = {
  country_code?: string;
  /** English country name (GeoIP only). */
  country?: string;
  region?: string;
  city?: string;
  source?: 'edge' | 'geoip';
};

export type QRLoginDetails = {
  session_id: string;
  status: QRLoginStatus;
  client: {
    browser: string;
    browser_version: string;
    os: string;
    device_type: 'desktop' | 'mobile' | 'tablet';
    user_agent: string;
  };
  ip: string;
  location: QRLoginLocation | null;
  created_at: string;
  expires_at: string;
};

/** Web-side create response (used by the mock demo only; the app never starts a QR session in live mode). */
export type QRLoginCreated = {
  session_id: string;
  qr_url: string;
  browser_secret: string;
  expires_at: string;
  expires_in: number;
  realtime: { ws_url: string; connection_token: string; subscription_token: string; channel: string };
};

/** Error codes the screens branch on. */
export const QR_ERRORS = {
  notFound: 'QR_SESSION_NOT_FOUND',
  resolved: 'QR_SESSION_RESOLVED',
  claimed: 'QR_SESSION_CLAIMED',
  deactivated: 'ACCOUNT_DEACTIVATED',
} as const;

const path = (id: string) => `/v1/auth/qr/sessions/${encodeURIComponent(id)}`;

export const qrLoginService = {
  get(sessionId: string) {
    return request<QRLoginDetails>('GET', path(sessionId), { silent: true });
  },
  approve(sessionId: string) {
    return request<{ status: 'approved' }>('POST', `${path(sessionId)}/approve`, { silent: true });
  },
  reject(sessionId: string) {
    return request<{ status: 'rejected' }>('POST', `${path(sessionId)}/reject`, { silent: true });
  },
  /** Mock demo: what the web login page does (anonymous). */
  createDemo() {
    return request<QRLoginCreated>('POST', '/v1/auth/qr/sessions', { anonymous: true, silent: true });
  },
};
