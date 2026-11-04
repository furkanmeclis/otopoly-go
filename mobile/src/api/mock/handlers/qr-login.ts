/**
 * QR sign-in, same contract as the Go API (`internal/modules/qrlogin`): sessions live 120 s, the first signed-in
 * viewer claims one, exactly one approve / reject wins, the exchange is single use and needs the browser secret.
 * Sessions are ephemeral (like Redis) and are not persisted with the demo DB.
 */
import { fail, now, route, str, type MockCtx } from '../core';
import { getDb } from '../db';

const SESSION_TTL_MS = 120_000;
const EXCHANGE_TTL_MS = 60_000;
const MAX_ATTEMPTS = 5;
const ID = /^[A-Za-z0-9_-]{43}$/;

type MockQRSession = {
  id: string;
  status: 'pending' | 'scanned' | 'approved' | 'rejected';
  secret: string;
  channel: string;
  userAgent: string;
  ip: string;
  createdAt: number;
  expiresAt: number;
  claimedBy: string | null;
  approvedOrg: string | null;
  exchangeToken: string | null;
  attempts: number;
};

const sessions = new Map<string, MockQRSession>();

function randomId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < 43; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function live(id: string) {
  const s = ID.test(id) ? sessions.get(id) : undefined;
  if (!s) return null;
  if (Date.now() >= s.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return s;
}

const notFound = () => fail(404, 'QR_SESSION_NOT_FOUND', 'This QR code has expired or was already used');
const claimed = () => fail(409, 'QR_SESSION_CLAIMED', 'This QR code was scanned by another account');
const invalid = () => fail(400, 'QR_LOGIN_INVALID', 'QR sign-in could not be verified');

function viewer(ctx: MockCtx) {
  if (!ctx.user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  return ctx.user!;
}

function burn(s: MockQRSession) {
  s.attempts++;
  if (s.attempts >= MAX_ATTEMPTS) sessions.delete(s.id);
}

/** Test / demo helper: drop every QR session. */
export function resetQRSessions() {
  sessions.clear();
}

/** Test helper: shift a session's expiry (simulates time passing). */
export function expireQRSession(id: string) {
  const s = sessions.get(id);
  if (s) s.expiresAt = Date.now() - 1;
}

route(
  'POST',
  '/v1/auth/qr/sessions',
  () => {
    const id = randomId();
    const created = Date.now();
    const s: MockQRSession = {
      id,
      status: 'pending',
      secret: randomId(),
      channel: `qrlogin:${randomId()}`,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      ip: '88.230.14.7',
      createdAt: created,
      expiresAt: created + SESSION_TTL_MS,
      claimedBy: null,
      approvedOrg: null,
      exchangeToken: null,
      attempts: 0,
    };
    sessions.set(id, s);
    return {
      session_id: id,
      qr_url: `https://otopoly.app/login/qr/${id}`,
      browser_secret: s.secret,
      expires_at: new Date(s.expiresAt).toISOString(),
      expires_in: SESSION_TTL_MS / 1000,
      realtime: { ws_url: 'wss://mock/connection/websocket', connection_token: 'mock-conn', subscription_token: 'mock-sub', channel: s.channel },
    };
  },
  { anonymous: true },
);

route('POST', '/v1/auth/qr/exchange', (ctx) => {
  const s = live(str(ctx.body.session_id));
  if (!s) notFound();
  if (s!.secret !== str(ctx.body.browser_secret) || !s!.exchangeToken || s!.exchangeToken !== str(ctx.body.exchange_token)) {
    burn(s!);
    invalid();
  }
  if (s!.status !== 'approved') invalid();
  sessions.delete(s!.id);
  const user = getDb().users.find((u) => u.uuid === s!.claimedBy);
  return { access_token: 'mock-web-at', refresh_token: 'mock-web-rt', token_type: 'Bearer', expires_in: 900, refresh_expires_at: now(), user: { uuid: s!.claimedBy, email: user?.email ?? '', name: user ? `${user.name} ${user.surname}` : '' } };
}, { anonymous: true });

route(
  'POST',
  '/v1/auth/qr/sessions/:id/state',
  (ctx) => {
    const s = live(ctx.params.id);
    if (!s) notFound();
    if (s!.secret !== str(ctx.body.browser_secret)) {
      burn(s!);
      invalid();
    }
    return { status: s!.status, ...(s!.status === 'approved' && s!.exchangeToken ? { exchange_token: s!.exchangeToken } : {}) };
  },
  { anonymous: true },
);

route('GET', '/v1/auth/qr/sessions/:id', (ctx) => {
  const user = viewer(ctx);
  const s = live(ctx.params.id);
  if (!s) notFound();
  if (s!.claimedBy && s!.claimedBy !== user.uuid) claimed();
  if (s!.status === 'pending') {
    s!.status = 'scanned';
    s!.claimedBy = user.uuid;
  }
  return {
    session_id: s!.id,
    status: s!.status === 'scanned' ? 'pending' : s!.status,
    client: { browser: 'Chrome', browser_version: '128', os: 'Windows', device_type: 'desktop', user_agent: s!.userAgent },
    ip: s!.ip,
    location: { country_code: 'TR', city: 'İstanbul', region: 'İstanbul', source: 'edge' },
    created_at: new Date(s!.createdAt).toISOString(),
    expires_at: new Date(s!.expiresAt).toISOString(),
  };
});

function resolve(ctx: MockCtx, status: 'approved' | 'rejected') {
  const user = viewer(ctx);
  if (status === 'approved' && user.status !== 'active') fail(403, 'ACCOUNT_DEACTIVATED', 'This account has been deleted');
  const s = live(ctx.params.id);
  if (!s) notFound();
  if (s!.claimedBy && s!.claimedBy !== user.uuid) claimed();
  if (s!.status !== 'pending' && s!.status !== 'scanned') fail(409, 'QR_SESSION_RESOLVED', 'This sign-in request was already answered');
  s!.status = status;
  s!.claimedBy = user.uuid;
  if (status === 'approved') {
    s!.exchangeToken = randomId();
    s!.approvedOrg = ctx.orgUuid;
  }
  s!.expiresAt = Date.now() + EXCHANGE_TTL_MS;
  return { status };
}

route('POST', '/v1/auth/qr/sessions/:id/approve', (ctx) => resolve(ctx, 'approved'));
route('POST', '/v1/auth/qr/sessions/:id/reject', (ctx) => resolve(ctx, 'rejected'));
