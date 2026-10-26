import type { Me } from '@/features/account/services/auth.service';

import { fail, now, requireFields, route, str, uuid, type MockCtx, type MockUser } from '../core';
import { DEMO_TOTP_CODE } from '../demo-auth';
import { getDb, persist } from '../db';
import { getAccessScenario } from '../scenario';
import { assertPasswordPolicy } from './account';

/** Exact role → permission sets computed from backend migrations (organization_user / organization_owner). */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  organization_user: [
    'auth.session', 'notifications.read', 'tenant.ai.use', 'tenant.billing.read',
    'tenant.calendar.read', 'tenant.calendar.write', 'tenant.cari.export', 'tenant.cari.read', 'tenant.catalog.export', 'tenant.catalog.read',
    'tenant.contracts.read', 'tenant.contracts.write', 'tenant.customers.read', 'tenant.customers.write',
    'tenant.finance.export', 'tenant.finance.read', 'tenant.jobs.export', 'tenant.jobs.read', 'tenant.jobs.write',
    'tenant.leads.read', 'tenant.leads.write', 'tenant.messaging.read', 'tenant.purchases.export',
    'tenant.purchases.read', 'tenant.quotes.read', 'tenant.quotes.write', 'tenant.reports.export',
    'tenant.reports.read', 'tenant.sales.export', 'tenant.sales.read', 'tenant.sales.write', 'tenant.staff.read',
    'tenant.suppliers.export', 'tenant.suppliers.read', 'tenant.todos.read', 'tenant.todos.write',
  ],
  organization_owner: [
    'auth.session', 'notifications.read', 'tenant.ai.use', 'tenant.billing.read', 'tenant.billing.write',
    'tenant.calendar.read', 'tenant.calendar.write', 'tenant.cari.export', 'tenant.cari.read', 'tenant.cari.write', 'tenant.catalog.export', 'tenant.catalog.import',
    'tenant.catalog.products.bulk.activate', 'tenant.catalog.products.bulk.adjust_stock',
    'tenant.catalog.products.bulk.deactivate', 'tenant.catalog.products.bulk.delete',
    'tenant.catalog.products.bulk.raise_cost_price', 'tenant.catalog.products.bulk.raise_sale_price',
    'tenant.catalog.read', 'tenant.catalog.services.bulk.activate', 'tenant.catalog.services.bulk.deactivate',
    'tenant.catalog.services.bulk.delete', 'tenant.catalog.services.bulk.raise_price', 'tenant.catalog.write',
    'tenant.contracts.read', 'tenant.contracts.write', 'tenant.customers.read', 'tenant.customers.write',
    'tenant.finance.export', 'tenant.finance.import', 'tenant.finance.read', 'tenant.finance.write',
    'tenant.imports.read', 'tenant.jobs.export', 'tenant.jobs.read', 'tenant.jobs.write', 'tenant.leads.read',
    'tenant.leads.write', 'tenant.messaging.read', 'tenant.messaging.write', 'tenant.purchases.export',
    'tenant.purchases.read', 'tenant.purchases.write', 'tenant.quotes.read', 'tenant.quotes.write',
    'tenant.reports.export', 'tenant.reports.read', 'tenant.sales.export', 'tenant.sales.read', 'tenant.sales.write',
    'tenant.settings.read', 'tenant.settings.write', 'tenant.staff.read', 'tenant.staff.write',
    'tenant.suppliers.export', 'tenant.suppliers.read', 'tenant.suppliers.write', 'tenant.todos.read',
    'tenant.todos.write',
  ],
};

export function permissionsFor(user: MockUser) {
  const out = new Set<string>();
  for (const role of user.roles) for (const p of ROLE_PERMISSIONS[role] ?? []) out.add(p);
  return out;
}

const ACCESS_TTL = 15 * 60;
const REFRESH_TTL_DAYS = 30;

// Access tokens: "mock-at.<userUuid>.<orgUuid|->.<nonce>" — the transport decodes them.
export function decodeAccessToken(token: string | undefined) {
  if (!token?.startsWith('mock-at.')) return null;
  const [, userUuid, org] = token.split('.');
  return { userUuid, orgUuid: org === '-' ? null : org };
}

export function issueTokens(user: MockUser, orgUuid: string | null, previousRefresh?: string) {
  const db = getDb();
  if (previousRefresh) db.sessions = db.sessions.filter((s) => s.token !== previousRefresh);
  const refresh = `mock-rt.${uuid()}`;
  const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000).toISOString();
  db.sessions.push({
    uuid: uuid(),
    token: refresh,
    userUuid: user.uuid,
    orgUuid,
    user_agent: 'Otopoly Mobile (demo)',
    ip_address: '10.0.0.24',
    created_at: now(),
    expires_at: expires,
  });
  persist();
  return {
    access_token: `mock-at.${user.uuid}.${orgUuid ?? '-'}.${Math.random().toString(36).slice(2, 8)}`,
    refresh_token: refresh,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_expires_at: expires,
  };
}

/** Membership + access validation, same errors as backend ResolveLoginOrganization. */
export function resolveOrganization(user: MockUser, slug: string) {
  const db = getDb();
  const org = db.organizations.find((o) => o.slug === slug);
  const membership = org && db.memberships.find((m) => m.orgUuid === org.uuid && m.userUuid === user.uuid);
  if (!org || !membership || getAccessScenario() === 'removed') fail(403, 'NO_TENANT_MEMBERSHIP', 'You are not a member of this organization');
  const view = orgAccessView(org!);
  const expired = view.access_ends_at && new Date(view.access_ends_at).getTime() <= Date.now();
  if (view.status === 'suspended' || expired) fail(403, 'ORGANIZATION_ACCESS_EXPIRED', 'Organization access has ended');
  return org!;
}

/**
 * Organization status / access end as the demo access scenario shows them (diagnostics screen):
 * `expired` moves `access_ends_at` to yesterday, `suspended` sets the status.
 */
export function orgAccessView<T extends { status: string; access_ends_at?: string | null }>(org: T): { status: string; access_ends_at: string | null } {
  const scenario = getAccessScenario();
  return {
    status: scenario === 'suspended' ? 'suspended' : org.status,
    access_ends_at: scenario === 'expired' ? new Date(Date.now() - 86400000).toISOString() : (org.access_ends_at ?? null),
  };
}

/** Tenant-route access check, same order and codes as backend `middleware.RequireOrganization`. */
export function enforceOrgAccess(orgUuid: string) {
  const scenario = getAccessScenario();
  if (scenario === 'removed') fail(403, 'NO_TENANT_MEMBERSHIP', 'You are not a member of this organization');
  const org = getDb().organizations.find((o) => o.uuid === orgUuid);
  if (!org) return;
  const view = orgAccessView(org);
  if (view.status === 'suspended') fail(403, 'FORBIDDEN', 'Organization is suspended');
  const ended = view.access_ends_at && new Date(view.access_ends_at).getTime() <= Date.now();
  if (view.status === 'expired' || ended) fail(403, 'ORGANIZATION_ACCESS_EXPIRED', 'Organization access has expired');
}

export function buildMe(user: MockUser, orgUuid: string | null): Me {
  const db = getDb();
  const orgs = db.memberships
    .filter((m) => m.userUuid === user.uuid && getAccessScenario() !== 'removed')
    .map((m) => {
      const o = db.organizations.find((x) => x.uuid === m.orgUuid)!;
      return {
        uuid: o.uuid,
        slug: o.slug,
        name: o.name,
        role: m.role,
        logo_url: o.logo_url,
        ...orgAccessView(o),
      };
    });
  const session = db.sessions.find((s) => s.userUuid === user.uuid && s.orgUuid === orgUuid);
  return {
    user: {
      uuid: user.uuid,
      email: user.email,
      name: user.name,
      surname: user.surname,
      status: user.status,
      locale: user.locale,
      is_super_admin: false,
      email_verified: true,
      created_at: user.created_at,
    },
    roles: user.roles,
    permissions: [...permissionsFor(user)].sort(),
    organizations: orgs,
    links: { profile: '/v1/auth/profile', change_password: '/v1/auth/password/change', notification_preferences: '/v1/notification-preferences' },
    channels: {},
    realtime: { enabled: false, user_channel: `user:${user.uuid}` },
    ...(session ? {} : {}),
  } as unknown as Me;
}

/**
 * Authenticator round-trip shared by every sign-in path: no `totp_code` → 403 MFA_REQUIRED,
 * wrong one → 401 INVALID_MFA_CODE. The demo authenticator always shows DEMO_TOTP_CODE.
 */
export function checkMfa(user: MockUser, totpCode: unknown) {
  if (!user.totpEnabled) return;
  const code = str(totpCode).replace(/\s/g, '');
  if (!code) fail(403, 'MFA_REQUIRED', 'Two-factor code required');
  if (code !== DEMO_TOTP_CODE) fail(401, 'INVALID_MFA_CODE', 'Invalid two-factor code');
}

function userFromCtx(ctx: MockCtx) {
  if (!ctx.user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  return ctx.user!;
}

route(
  'POST',
  '/v1/auth/login',
  (ctx) => {
    requireFields(ctx.body, ['email', 'password']);
    const email = str(ctx.body.email).trim().toLowerCase();
    const user = getDb().users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.password !== str(ctx.body.password)) fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (user!.deactivatedAt) fail(403, 'ACCOUNT_DEACTIVATED', 'This account has been deleted');
    if (user!.status !== 'active') fail(403, 'FORBIDDEN', 'User is disabled');
    checkMfa(user!, ctx.body.totp_code);
    const slug = str(ctx.body.organization_slug).trim();
    const org = slug ? resolveOrganization(user!, slug) : null;
    return issueTokens(user!, org?.uuid ?? null);
  },
  { anonymous: true },
);

// Self-serve sign-up with a password (backend `AuthUseCase.Register`): creates the user, no tokens.
route(
  'POST',
  '/v1/auth/register',
  (ctx) => {
    if ((getDb() as { _registrationEnabled?: boolean })._registrationEnabled === false) fail(403, 'FORBIDDEN', 'registration is disabled');
    const email = str(ctx.body.email).trim().toLowerCase();
    const name = str(ctx.body.name).trim();
    const surname = str(ctx.body.surname).trim();
    if (!email || !name || !surname || !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'VALIDATION_ERROR', 'email, name, surname are required');
    if (!str(ctx.body.password).trim()) fail(400, 'VALIDATION_ERROR', 'password is required');
    const db = getDb();
    if (db.users.some((u) => u.email.toLowerCase() === email)) fail(409, 'CONFLICT', 'email already registered');
    // Backend answers a policy miss with a plain 400 VALIDATION_ERROR (no field details).
    try {
      assertPasswordPolicy(str(ctx.body.password), 'password');
    } catch {
      fail(400, 'VALIDATION_ERROR', 'password does not meet policy');
    }
    const user: MockUser = {
      uuid: uuid(),
      email,
      password: str(ctx.body.password),
      name,
      surname,
      locale: 'tr',
      status: 'active',
      roles: ['organization_user'],
      totpEnabled: false,
      created_at: now(),
    };
    db.users.push(user);
    persist();
    return { user: { uuid: user.uuid, email, name, surname, status: 'active', is_super_admin: false, email_verified: false, locale: 'tr' } };
  },
  { anonymous: true },
);

route(
  'POST',
  '/v1/auth/refresh',
  (ctx) => {
    const token = str(ctx.body.refresh_token);
    const db = getDb();
    const s = db.sessions.find((x) => x.token === token);
    if (!s || new Date(s.expires_at).getTime() < Date.now()) fail(401, 'UNAUTHENTICATED', 'Refresh token invalid');
    const user = db.users.find((u) => u.uuid === s!.userUuid);
    if (user?.deactivatedAt) fail(403, 'ACCOUNT_DEACTIVATED', 'This account has been deleted');
    if (!user || user.status !== 'active') fail(401, 'UNAUTHENTICATED', 'User disabled');
    return issueTokens(user!, s!.orgUuid, token);
  },
  { anonymous: true },
);

route('POST', '/v1/auth/organization-context', (ctx) => {
  const user = userFromCtx(ctx);
  requireFields(ctx.body, ['organization_slug']);
  const org = resolveOrganization(user, str(ctx.body.organization_slug));
  return issueTokens(user, org.uuid);
});

route('POST', '/v1/auth/logout', (ctx) => {
  const db = getDb();
  db.sessions = db.sessions.filter((s) => s.token !== str(ctx.body.refresh_token));
  persist();
  return { status: 'ok' };
});

route('GET', '/v1/auth/me', (ctx) => buildMe(userFromCtx(ctx), ctx.orgUuid));

route('PATCH', '/v1/auth/profile', (ctx) => {
  const user = userFromCtx(ctx);
  const blank = (['name', 'surname'] as const).filter((f) => ctx.body[f] !== undefined && !str(ctx.body[f]).trim());
  if (blank.length) fail(400, 'VALIDATION_ERROR', 'Validation failed', blank.map((field) => ({ field, message: 'required', code: 'required' })));
  if (ctx.body.name !== undefined) user.name = str(ctx.body.name).trim();
  if (ctx.body.surname !== undefined) user.surname = str(ctx.body.surname).trim();
  if (ctx.body.locale !== undefined) {
    const locale = str(ctx.body.locale);
    if (locale !== 'tr' && locale !== 'en') fail(400, 'VALIDATION_ERROR', 'Unsupported locale', [{ field: 'locale', message: 'must be tr or en' }]);
    user.locale = locale;
  }
  persist();
  return buildMe(user, ctx.orgUuid);
});

route('POST', '/v1/auth/password/change', (ctx) => {
  const user = userFromCtx(ctx);
  requireFields(ctx.body, ['current_password', 'new_password']);
  if (str(ctx.body.current_password) !== user.password) {
    // Backend usecase.ErrInvalidCredentials → 401 INVALID_CREDENTIALS (not a field validation error).
    fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  assertPasswordPolicy(str(ctx.body.new_password), 'new_password');
  user.password = str(ctx.body.new_password);
  // Backend revokes every refresh session on password change (the client signs out right after).
  const db = getDb();
  db.sessions = db.sessions.filter((s) => s.userUuid !== user.uuid);
  persist();
  return { status: 'ok' };
});

route('POST', '/v1/auth/password/forgot', () => ({ status: 'ok' }), { anonymous: true });

route(
  'GET',
  '/v1/public/organizations/by-slug/:slug',
  (ctx) => {
    const org = getDb().organizations.find((o) => o.slug === ctx.params.slug);
    if (!org) fail(404, 'NOT_FOUND', 'Organization not found');
    const accessOk = org!.status === 'active' && (!org!.access_ends_at || new Date(org!.access_ends_at).getTime() > Date.now());
    return { uuid: org!.uuid, slug: org!.slug, name: org!.name, status: org!.status, logo_url: org!.logo_url, access_ok: accessOk };
  },
  { anonymous: true },
);

route('GET', '/v1/auth/sessions', (ctx) => {
  const user = userFromCtx(ctx);
  const db = getDb();
  const items = db.sessions
    .filter((s) => s.userUuid === user.uuid)
    .map((s, i, arr) => ({
      uuid: s.uuid,
      current: i === arr.length - 1,
      user_agent: s.user_agent,
      ip_address: s.ip_address,
      created_at: s.created_at,
      expires_at: s.expires_at,
      impersonated: false,
    }))
    .reverse();
  return { items };
});

route('DELETE', '/v1/auth/sessions/:uuid', (ctx) => {
  const user = userFromCtx(ctx);
  const db = getDb();
  db.sessions = db.sessions.filter((s) => !(s.uuid === ctx.params.uuid && s.userUuid === user.uuid));
  persist();
  return { status: 'ok' };
});

route('POST', '/v1/auth/sessions/revoke-others', (ctx) => {
  const user = userFromCtx(ctx);
  const db = getDb();
  const mine = db.sessions.filter((s) => s.userUuid === user.uuid);
  const keep = mine[mine.length - 1];
  db.sessions = db.sessions.filter((s) => s.userUuid !== user.uuid || s === keep);
  persist();
  return { status: 'ok' };
});

route('GET', '/v1/auth/totp', (ctx) => ({ enabled: userFromCtx(ctx).totpEnabled, confirmed_at: null }));
