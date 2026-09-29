import type { Me } from '@/features/account/services/auth.service';

import { fail, now, requireFields, route, str, uuid, type MockCtx, type MockUser } from '../core';
import { getDb, persist } from '../db';

/** Exact role → permission sets computed from backend migrations (organization_user / organization_owner). */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  organization_user: [
    'auth.session', 'notifications.read', 'tenant.ai.use', 'tenant.billing.read',
    'tenant.cari.export', 'tenant.cari.read', 'tenant.catalog.export', 'tenant.catalog.read',
    'tenant.contracts.read', 'tenant.contracts.write', 'tenant.customers.read', 'tenant.customers.write',
    'tenant.finance.export', 'tenant.finance.read', 'tenant.jobs.export', 'tenant.jobs.read', 'tenant.jobs.write',
    'tenant.leads.read', 'tenant.leads.write', 'tenant.messaging.read', 'tenant.purchases.export',
    'tenant.purchases.read', 'tenant.quotes.read', 'tenant.quotes.write', 'tenant.reports.export',
    'tenant.reports.read', 'tenant.sales.export', 'tenant.sales.read', 'tenant.sales.write', 'tenant.staff.read',
    'tenant.suppliers.export', 'tenant.suppliers.read', 'tenant.todos.read', 'tenant.todos.write',
  ],
  organization_owner: [
    'auth.session', 'notifications.read', 'tenant.ai.use', 'tenant.billing.read', 'tenant.billing.write',
    'tenant.cari.export', 'tenant.cari.read', 'tenant.cari.write', 'tenant.catalog.export', 'tenant.catalog.import',
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

function issueTokens(user: MockUser, orgUuid: string | null, previousRefresh?: string) {
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
function resolveOrganization(user: MockUser, slug: string) {
  const db = getDb();
  const org = db.organizations.find((o) => o.slug === slug);
  const membership = org && db.memberships.find((m) => m.orgUuid === org.uuid && m.userUuid === user.uuid);
  if (!org || !membership) fail(403, 'NO_TENANT_MEMBERSHIP', 'You are not a member of this organization');
  const expired = org!.access_ends_at && new Date(org!.access_ends_at).getTime() <= Date.now();
  if (org!.status === 'suspended' || expired) fail(403, 'ORGANIZATION_ACCESS_EXPIRED', 'Organization access has ended');
  return org!;
}

export function buildMe(user: MockUser, orgUuid: string | null): Me {
  const db = getDb();
  const orgs = db.memberships
    .filter((m) => m.userUuid === user.uuid)
    .map((m) => {
      const o = db.organizations.find((x) => x.uuid === m.orgUuid)!;
      return {
        uuid: o.uuid,
        slug: o.slug,
        name: o.name,
        role: m.role,
        logo_url: o.logo_url,
        status: o.status,
        access_ends_at: o.access_ends_at,
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
    links: {},
    channels: {},
    realtime: { enabled: false, user_channel: `user:${user.uuid}` },
    ...(session ? {} : {}),
  } as unknown as Me;
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
    if (user!.status !== 'active') fail(403, 'ACCOUNT_DISABLED', 'This account is disabled');
    if (user!.totpEnabled && !ctx.body.totp_code) fail(401, 'TOTP_REQUIRED', 'Two-factor code required');
    const slug = str(ctx.body.organization_slug).trim();
    const org = slug ? resolveOrganization(user!, slug) : null;
    return issueTokens(user!, org?.uuid ?? null);
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
  if (ctx.body.name !== undefined) user.name = str(ctx.body.name).trim() || user.name;
  if (ctx.body.surname !== undefined) user.surname = str(ctx.body.surname).trim() || user.surname;
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
    fail(400, 'VALIDATION_ERROR', 'Current password is incorrect', [{ field: 'current_password', message: 'incorrect' }]);
  }
  if (str(ctx.body.new_password).length < 8) {
    fail(400, 'VALIDATION_ERROR', 'Password too short', [{ field: 'new_password', message: 'min 8 characters' }]);
  }
  user.password = str(ctx.body.new_password);
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
    return { uuid: org!.uuid, slug: org!.slug, name: org!.name, logo_url: org!.logo_url, access_ok: accessOk };
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
