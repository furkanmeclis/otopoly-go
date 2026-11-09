/**
 * Passwordless sign-in and account deletion, mirroring backend `feat/auth-otp-native-oauth`
 * (docs/backend/WAVE1_CONTRACTS.md):
 *   e-mail code      POST /v1/auth/email-code/request · /verify
 *   native OAuth     POST /v1/auth/oauth/{apple|google}/native
 *   relay linking    POST /v1/auth/oauth/link/request · /verify · /create
 *   deletion         POST /v1/auth/account/deactivate/request · /deactivate (30-day recovery is web-only)
 */
import { businessDayOf, shiftDay } from '@/lib/business-date';
import { createLogger } from '@/lib/logger';

import { fail, MockHttpError, now, route, str, uuid, validation, type MockCtx, type MockUser } from '../core';
import { getDb, type MockDb } from '../db';
import { DEMO_EMAIL_CODE, DEMO_IDENTITIES, DEMO_REVIEW_EMAILS, parseDemoIdToken, recordIssuedCode } from '../demo-auth';
import { checkMfa, issueTokens, resolveOrganization } from './auth';

const log = createLogger('mock.auth');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LINK_TICKET_TTL_S = 900;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RELAY_DOMAIN = '@privaterelay.appleid.com';

type Purpose = 'login' | 'link' | 'deactivate';
type CodeRow = { code: string; expiresAt: number; attempts: number };
type Identity = { provider: string; sub: string; userUuid: string; linkedAt: string };
type LinkTicket = { provider: string; sub: string; email: string; given_name?: string; family_name?: string; registerAllowed: boolean; expiresAt: number };

// Extra rows on the persisted DB object (lazily created, no shared schema change).
type AuthExt = {
  _authCodes?: Record<string, CodeRow>;
  _authRequests?: Record<string, number[]>;
  _oauthIdentities?: Identity[];
  _linkTickets?: Record<string, LinkTicket>;
  /** Native sign-in turned off per provider (`403 OAUTH_PROVIDER_DISABLED`). */
  _oauthDisabled?: Record<string, boolean>;
  /** Global `registration_enabled` (default on). */
  _registrationEnabled?: boolean;
};
const ext = () => getDb() as MockDb & AuthExt;

const normEmail = (v: unknown) => str(v).trim().toLowerCase();
const findUser = (email: string) => getDb().users.find((u) => u.email.toLowerCase() === email) ?? null;
const codeKey = (purpose: Purpose, scope: string) => `${purpose}:${scope}`;

function assertEmail(field: string, email: string) {
  if (!email) validation([{ field, message: 'required', code: 'required' }]);
  if (!/^\S+@\S+\.\S+$/.test(email)) validation([{ field, message: 'must be a valid email', code: 'email' }]);
}

/** 5 requests per 15 minutes per key, like the backend limiter: 429 RATE_LIMITED + Retry-After. */
function rateLimited(key: string, max = 5) {
  const db = ext();
  const at = Date.now();
  const recent = (db._authRequests?.[key] ?? []).filter((t) => at - t < RATE_WINDOW_MS);
  if (recent.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - at) / 1000));
    throw new MockHttpError(429, 'RATE_LIMITED', 'Too many requests', undefined, retryAfter);
  }
  db._authRequests = { ...db._authRequests, [key]: [...recent, at] };
}

function issueCode(purpose: Purpose, scope: string, email: string) {
  const fixed = (DEMO_REVIEW_EMAILS as readonly string[]).includes(email);
  const code = fixed ? DEMO_EMAIL_CODE : String(Math.floor(100000 + Math.random() * 900000));
  const db = ext();
  db._authCodes = { ...db._authCodes, [codeKey(purpose, scope)]: { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 } };
  // Demo: the "e-mail" goes to the diagnostics screen instead of an inbox.
  recordIssuedCode({ email, code, purpose });
  log.info('Demo e-mail code issued', { purpose, email, code });
}

/** Wrong / expired / used / exhausted → 400 INVALID_EMAIL_CODE. A wrong attempt is counted. */
function checkCode(purpose: Purpose, scope: string, code: string) {
  const db = ext();
  const key = codeKey(purpose, scope);
  const row = db._authCodes?.[key];
  if (!row || row.expiresAt < Date.now() || row.attempts >= MAX_ATTEMPTS) fail(400, 'INVALID_EMAIL_CODE', 'The code is invalid or has expired');
  if (row!.code !== code.replace(/\s/g, '')) {
    row!.attempts += 1;
    fail(400, 'INVALID_EMAIL_CODE', 'The code is invalid or has expired');
  }
  return {
    /** A wrong TOTP burns one of the code's attempts. */
    burn: () => void (row!.attempts += 1),
    consume: () => {
      const next = { ...db._authCodes };
      delete next[key];
      db._authCodes = next;
    },
  };
}

function assertCanSignIn(user: MockUser) {
  if (user.deactivatedAt) fail(403, 'ACCOUNT_DEACTIVATED', 'This account has been deleted');
  if (user.status !== 'active') fail(403, 'FORBIDDEN', 'This account is disabled');
}

/** MFA round-trip with the e-mail code kept alive: a wrong TOTP burns an attempt, success consumes the code. */
function finishWithCode(user: MockUser, ctx: MockCtx, code: ReturnType<typeof checkCode>) {
  assertCanSignIn(user);
  try {
    checkMfa(user, ctx.body.totp_code);
  } catch (error) {
    if ((error as { code?: string }).code === 'INVALID_MFA_CODE') code.burn();
    throw error;
  }
  const slug = str(ctx.body.organization_slug).trim();
  const org = slug ? resolveOrganization(user, slug) : null;
  code.consume();
  return issueTokens(user, org?.uuid ?? null);
}

function signIn(user: MockUser, ctx: MockCtx) {
  assertCanSignIn(user);
  checkMfa(user, ctx.body.totp_code);
  const slug = str(ctx.body.organization_slug).trim();
  const org = slug ? resolveOrganization(user, slug) : null;
  return issueTokens(user, org?.uuid ?? null);
}

// ─── E-mail code sign-in ───────────────────────────────────────────────────

route(
  'POST',
  '/v1/auth/email-code/request',
  (ctx) => {
    const email = normEmail(ctx.body.email);
    assertEmail('email', email);
    rateLimited(`email-code:${email}`);
    // Same answer whether or not the account exists (no enumeration). Deactivated users still get
    // a code so verify can report ACCOUNT_DEACTIVATED once the mailbox is proven; an unknown address
    // gets one too: verifying it creates the account (signed in, no organization yet).
    issueCode('login', email, email);
    return { status: 'accepted' };
  },
  { anonymous: true },
);

route(
  'POST',
  '/v1/auth/email-code/verify',
  (ctx) => {
    const email = normEmail(ctx.body.email);
    const code = str(ctx.body.code).trim();
    const missing = [!email && 'email', !code && 'code'].filter(Boolean) as string[];
    if (missing.length) validation(missing.map((field) => ({ field, message: 'required', code: 'required' })));
    const user = findUser(email);
    const checked = checkCode('login', email, code);
    if (user) return finishWithCode(user, ctx, checked);
    // Unknown e-mail with a proven mailbox: sign-up (same result as a new Apple / Google user).
    if (ext()._registrationEnabled === false) fail(403, 'FORBIDDEN', 'Registration is disabled');
    checked.consume();
    const created = createOAuthUser(email);
    log.info('Demo account created by e-mail code', { email });
    return issueTokens(created, null);
  },
  { anonymous: true },
);

// ─── Native Apple / Google ─────────────────────────────────────────────────

function identities() {
  const db = ext();
  if (!db._oauthIdentities) {
    // Seed the demo identities that start out linked.
    db._oauthIdentities = DEMO_IDENTITIES.flatMap((i) => {
      const user = i.linkedTo ? findUser(i.linkedTo) : null;
      return user ? [{ provider: i.provider, sub: i.sub, userUuid: user.uuid, linkedAt: now() }] : [];
    });
  }
  return db._oauthIdentities;
}

function createOAuthUser(email: string, givenName?: string, familyName?: string): MockUser {
  const user: MockUser = {
    uuid: uuid(),
    email,
    password: `!oauth-${uuid()}`,
    name: givenName?.trim() || email.split('@')[0],
    surname: familyName?.trim() || '',
    locale: 'tr',
    status: 'active',
    roles: ['organization_user'],
    totpEnabled: false,
    created_at: now(),
  };
  getDb().users.push(user);
  return user;
}

function link(provider: string, sub: string, user: MockUser) {
  ext()._oauthIdentities = [...identities(), { provider, sub, userUuid: user.uuid, linkedAt: now() }];
}

/** Relay account without its identity: status and 2FA as for any sign-in, never over another Apple ID. */
function relinkRelayOwner(user: MockUser, provider: string, sub: string, ctx: MockCtx) {
  if (identities().some((i) => i.provider === provider && i.userUuid === user.uuid && i.sub !== sub)) {
    fail(409, 'CONFLICT', 'The account already has an identity for this provider');
  }
  const tokens = signIn(user, ctx);
  if (!identities().some((i) => i.provider === provider && i.sub === sub)) link(provider, sub, user);
  return tokens;
}

route(
  'POST',
  '/v1/auth/oauth/:provider/native',
  (ctx) => {
    const provider = ctx.params.provider;
    if (provider !== 'apple' && provider !== 'google') fail(404, 'NOT_FOUND', 'Unknown provider');
    if (ext()._oauthDisabled?.[provider]) fail(403, 'OAUTH_PROVIDER_DISABLED', 'Native sign-in is not enabled for this provider');
    const idToken = str(ctx.body.id_token).trim();
    if (!idToken) validation([{ field: 'id_token', message: 'required', code: 'required' }]);
    const parsed = parseDemoIdToken(idToken);
    if (!parsed || parsed.identity.provider !== provider) fail(401, 'INVALID_ID_TOKEN', 'The identity token is invalid');
    const nonce = str(ctx.body.nonce);
    if (parsed!.nonce && parsed!.nonce !== nonce) fail(401, 'INVALID_ID_TOKEN', 'The identity token nonce does not match');
    const { identity } = parsed!;

    const linked = identities().find((i) => i.provider === provider && i.sub === identity.sub);
    const db = getDb();
    if (linked) {
      const user = db.users.find((u) => u.uuid === linked.userUuid);
      if (!user) fail(401, 'INVALID_ID_TOKEN', 'Linked account missing');
      return signIn(user!, ctx);
    }
    const email = identity.email.toLowerCase();
    const owner = findUser(email);
    // Backend: only that Apple ID can present its relay address, so its account signs in and re-links.
    if (owner && provider === 'apple' && email.endsWith(RELAY_DOMAIN)) return relinkRelayOwner(owner, provider, identity.sub, ctx);
    if (owner) fail(409, 'OAUTH_ACCOUNT_NOT_LINKED', 'Sign in the usual way and link this provider from your profile');
    const registerAllowed = ext()._registrationEnabled !== false && identity.registerAllowed !== false;
    if (provider === 'apple' && email.endsWith(RELAY_DOMAIN)) {
      const ticket = `mock-lt.${uuid()}`;
      const tickets = ext();
      tickets._linkTickets = {
        ...tickets._linkTickets,
        [ticket]: {
          provider,
          sub: identity.sub,
          email,
          given_name: str(ctx.body.given_name) || identity.given_name,
          family_name: str(ctx.body.family_name) || identity.family_name,
          registerAllowed,
          expiresAt: Date.now() + LINK_TICKET_TTL_S * 1000,
        },
      };
      fail(409, 'OAUTH_LINK_CHOICE_REQUIRED', 'Choose whether to link this sign-in to an existing account or create a new one', [
        { field: 'link_ticket', message: ticket },
        { field: 'provider', message: provider },
        { field: 'expires_in', message: String(LINK_TICKET_TTL_S) },
        { field: 'register_allowed', message: String(registerAllowed) },
      ]);
    }
    if (!registerAllowed) fail(403, 'FORBIDDEN', 'Registration is disabled');
    const user = createOAuthUser(email, str(ctx.body.given_name) || identity.given_name, str(ctx.body.family_name) || identity.family_name);
    link(provider, identity.sub, user);
    return issueTokens(user, null);
  },
  { anonymous: true },
);

// ─── Apple private-relay linking ──────────────────────────────────────────

function ticketOf(ctx: MockCtx) {
  const ticket = str(ctx.body.link_ticket).trim();
  const row = ticket ? ext()._linkTickets?.[ticket] : undefined;
  if (!row || row.expiresAt < Date.now()) fail(400, 'INVALID_LINK_TICKET', 'The link ticket is invalid or has expired');
  return { ticket, row: row! };
}

route(
  'POST',
  '/v1/auth/oauth/link/request',
  (ctx) => {
    const { ticket } = ticketOf(ctx);
    const email = normEmail(ctx.body.email);
    assertEmail('email', email);
    rateLimited(`link:${email}`);
    if (findUser(email)) issueCode('link', `${ticket}:${email}`, email);
    return { status: 'accepted' };
  },
  { anonymous: true },
);

route(
  'POST',
  '/v1/auth/oauth/link/verify',
  (ctx) => {
    const { ticket, row } = ticketOf(ctx);
    const email = normEmail(ctx.body.email);
    const code = str(ctx.body.code).trim();
    const missing = [!email && 'email', !code && 'code'].filter(Boolean) as string[];
    if (missing.length) validation(missing.map((field) => ({ field, message: 'required', code: 'required' })));
    const user = findUser(email);
    if (!user) fail(400, 'INVALID_EMAIL_CODE', 'The code is invalid or has expired');
    const checked = checkCode('link', `${ticket}:${email}`, code);
    const all = identities();
    if (all.some((i) => i.provider === row.provider && i.sub === row.sub && i.userUuid !== user!.uuid)) fail(409, 'CONFLICT', 'This identity is linked to another account');
    if (all.some((i) => i.provider === row.provider && i.userUuid === user!.uuid && i.sub !== row.sub)) fail(409, 'CONFLICT', 'The account already has an identity for this provider');
    const tokens = finishWithCode(user!, ctx, checked);
    if (!all.some((i) => i.provider === row.provider && i.sub === row.sub)) link(row.provider, row.sub, user!);
    return tokens;
  },
  { anonymous: true },
);

route(
  'POST',
  '/v1/auth/oauth/link/create',
  (ctx) => {
    const { row } = ticketOf(ctx);
    const existing = findUser(row.email);
    if (existing) {
      // Retrying with the same ticket signs into the account the first call created.
      const mine = identities().some((i) => i.provider === row.provider && i.sub === row.sub && i.userUuid === existing.uuid);
      if (mine) return signIn(existing, ctx);
      // The relay account lost its identity (or an earlier create stopped before linking): re-link.
      if (row.provider === 'apple' && row.email.endsWith(RELAY_DOMAIN)) return relinkRelayOwner(existing, row.provider, row.sub, ctx);
      fail(409, 'CONFLICT', 'This email was registered meanwhile');
    }
    if (!row.registerAllowed) fail(403, 'FORBIDDEN', 'Registration is disabled');
    const user = createOAuthUser(row.email, row.given_name, row.family_name);
    link(row.provider, row.sub, user);
    return signIn(user, ctx);
  },
  { anonymous: true },
);

// ─── Account deletion (deactivation) ──────────────────────────────────────

function userOf(ctx: MockCtx) {
  if (!ctx.user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  return ctx.user!;
}

route('POST', '/v1/auth/account/deactivate/request', (ctx) => {
  const user = userOf(ctx);
  rateLimited(`deactivate:${user.uuid}`);
  issueCode('deactivate', user.uuid, user.email.toLowerCase());
  return { status: 'accepted' };
});

route('POST', '/v1/auth/account/deactivate', (ctx) => {
  const user = userOf(ctx);
  const code = str(ctx.body.code).trim();
  // The mock has no step-up grants: without a code the backend answers STEP_UP_REQUIRED.
  if (!code) fail(403, 'STEP_UP_REQUIRED', 'Confirm your identity first');
  const checked = checkCode('deactivate', user.uuid, code);
  const db = getDb();
  if (user.isSuperAdmin && !db.users.some((u) => u.isSuperAdmin && u.uuid !== user.uuid && !u.deactivatedAt)) {
    fail(409, 'CONFLICT', 'The last super admin cannot be deactivated');
  }
  checked.consume();
  user.deactivatedAt = now();
  user.status = 'inactive';
  // Every refresh session is revoked; organizations the user owns stay as they are.
  db.sessions = db.sessions.filter((s) => s.userUuid !== user.uuid);
  log.info('Demo account deletion scheduled', { email: user.email });
  // Backend: Europe/Istanbul day + 30 (bizclock).
  const scheduled = shiftDay(businessDayOf(new Date()), 30);
  return { status: 'scheduled', deletion_scheduled_on: scheduled, grace_days: 30, owned_organizations: [] };
});

// ─── Linked accounts (profile) ────────────────────────────────────────────
// GET/DELETE mirror the backend (`/v1/auth/identities[/{provider}]`). Two mobile additions the
// backend doesn't have yet (docs/port-reports/account.md): `has_password` on the list, and
// `POST /v1/auth/identities/{provider}/native` to link with a native id_token while signed in.

/** OAuth-created accounts get a random unusable password (`createOAuthUser`). */
const hasPassword = (user: MockUser) => !user.password.startsWith('!oauth-');

function identityList(user: MockUser) {
  const items = identities()
    .filter((i) => i.userUuid === user.uuid)
    .map((i) => ({ provider: i.provider, github_login: null, linked_at: i.linkedAt }));
  return { items, total: items.length, has_password: hasPassword(user) };
}

route('GET', '/v1/auth/identities', (ctx) => identityList(userOf(ctx)));

route('POST', '/v1/auth/identities/:provider/native', (ctx) => {
  const user = userOf(ctx);
  const provider = ctx.params.provider;
  if (provider !== 'apple' && provider !== 'google') fail(404, 'NOT_FOUND', 'Unknown OAuth provider');
  if (ext()._oauthDisabled?.[provider]) fail(403, 'OAUTH_PROVIDER_DISABLED', 'Native sign-in is not enabled for this provider');
  const idToken = str(ctx.body.id_token).trim();
  if (!idToken) validation([{ field: 'id_token', message: 'required', code: 'required' }]);
  const parsed = parseDemoIdToken(idToken);
  if (!parsed || parsed.identity.provider !== provider) fail(401, 'INVALID_ID_TOKEN', 'The identity token is invalid');
  if (parsed!.nonce && parsed!.nonce !== str(ctx.body.nonce)) fail(401, 'INVALID_ID_TOKEN', 'The identity token nonce does not match');
  const all = identities();
  const owner = all.find((i) => i.provider === provider && i.sub === parsed!.identity.sub);
  if (owner && owner.userUuid !== user.uuid) fail(409, 'CONFLICT', 'this sign-in is already linked to another account');
  const mine = all.find((i) => i.provider === provider && i.userUuid === user.uuid);
  if (mine && mine.sub !== parsed!.identity.sub) fail(409, 'CONFLICT', 'The account already has an identity for this provider');
  if (!owner) link(provider, parsed!.identity.sub, user);
  const row = identities().find((i) => i.provider === provider && i.userUuid === user.uuid)!;
  log.info('Demo identity linked', { provider, email: user.email });
  return { provider, github_login: null, linked_at: row.linkedAt };
});

route('DELETE', '/v1/auth/identities/:provider', (ctx) => {
  const user = userOf(ctx);
  const provider = ctx.params.provider;
  if (!['github', 'google', 'facebook', 'apple'].includes(provider)) fail(404, 'NOT_FOUND', 'Unknown OAuth provider');
  const all = identities();
  const mine = all.filter((i) => i.userUuid === user.uuid);
  if (!mine.some((i) => i.provider === provider)) fail(404, 'NOT_FOUND', 'Linked identity not found');
  // An account without a password must keep at least one way in besides the e-mail code.
  if (!hasPassword(user) && mine.length <= 1) fail(409, 'LAST_SIGN_IN_METHOD', 'Set a password or link another account before removing this one');
  ext()._oauthIdentities = all.filter((i) => !(i.userUuid === user.uuid && i.provider === provider));
  return { status: 'unlinked' };
});
