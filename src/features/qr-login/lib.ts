import type { QRLoginDetails } from './qr-login.service';

/** Same shape the Go API generates (32 random bytes, base64url, no padding). */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

/** Web hosts whose `/login/qr/{id}` links the app accepts (universal link domain). */
export const QR_LOGIN_HOSTS = ['otopoly.app', 'www.otopoly.app'];

export function isQRSessionId(value: string) {
  return SESSION_ID.test(value);
}

/**
 * Extracts the session id from a scanned code: `https://otopoly.app/login/qr/{id}` or `otopoly://login/qr/{id}`.
 * Anything else (other hosts, other paths) returns null so the scanner never opens arbitrary links.
 */
export function parseQRLoginCode(raw: string, extraHosts: string[] = []): string | null {
  const value = raw.trim();
  const custom = /^otopoly:\/\/\/?login\/qr\/([^/?#]+)\/?$/.exec(value);
  if (custom) return isQRSessionId(custom[1]) ? custom[1] : null;
  const web = /^(https?):\/\/([^/?#]+)\/login\/qr\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(value);
  if (!web) return null;
  const host = web[2].toLowerCase();
  const extra = extraHosts.map((h) => h.toLowerCase());
  // Production links are https on the universal-link domain; a dev web origin (EXPO_PUBLIC_WEB_URL) may be http.
  const allowed = (web[1].toLowerCase() === 'https' && QR_LOGIN_HOSTS.includes(host)) || extra.includes(host);
  if (!allowed) return null;
  return isQRSessionId(web[3]) ? web[3] : null;
}

/** "Chrome 128 · Windows" (falls back to the raw user agent). */
export function clientLabel(client: QRLoginDetails['client'], unknown: string) {
  const browser = [client.browser, client.browser_version].filter(Boolean).join(' ');
  const parts = [browser, client.os].filter(Boolean);
  return parts.length ? parts.join(' · ') : client.user_agent || unknown;
}

/** "İstanbul, TR" style; null when the API had no location (the screen shows the IP only). */
export function locationLabel(location: QRLoginDetails['location']) {
  if (!location) return null;
  const place = location.city || location.region;
  const country = location.country || location.country_code;
  const label = [place, country].filter(Boolean).join(', ');
  return label || null;
}
