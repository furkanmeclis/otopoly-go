/**
 * Self-service onboarding, mirroring the backend contract being added in parallel:
 *   POST /v1/auth/organizations   bearer, no organization context → 201 { organization: { uuid, slug, name } }
 *     400 VALIDATION_ERROR · 401 · 403 FORBIDDEN (self-registration disabled) · 409 CONFLICT (already owns a
 *     business) · 429 RATE_LIMITED. The new organization gets a 14-day trial and the caller is its owner.
 *   GET  /v1/app/config           public bootstrap config (`registration_enabled`, `auth_methods`).
 *
 * Demo limitation: catalog, customers and most other mock tables are not scoped per organization, so a
 * business created here sees the demo business's records (the API scopes everything by organization).
 */
import { createLogger } from '@/lib/logger';

import { fail, MockHttpError, now, route, str, uuid, validation } from '../core';
import { getDb, persist, type MockDb } from '../db';

const log = createLogger('mock.onboarding');

const TRIAL_DAYS = 14;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;

type OnboardingExt = { _registrationEnabled?: boolean; _orgCreateRequests?: Record<string, number[]> };
const ext = () => getDb() as MockDb & OnboardingExt;

export const registrationEnabled = () => ext()._registrationEnabled !== false;

/** "Parlak Oto Yıkama & Detailing" → "parlak-oto-yikama-detailing", unique among organizations. */
export function slugFor(name: string) {
  const base =
    name
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'isletme';
  const taken = new Set(getDb().organizations.map((o) => o.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

route(
  'GET',
  '/v1/app/config',
  () => {
    const register = registrationEnabled();
    const method = (login: boolean, reg: boolean) => ({ login, register: register && reg });
    return {
      mode: 'platform',
      name: 'Otopoly',
      vapid_configured: false,
      github_auth_enabled: false,
      registration_enabled: register,
      auth_methods: {
        password: method(true, false),
        passkey: { login: false },
        github: method(false, false),
        google: method(true, true),
        facebook: method(false, false),
        apple: method(true, true),
      },
    };
  },
  { anonymous: true },
);

route('POST', '/v1/auth/organizations', (ctx) => {
  if (!ctx.user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  const user = ctx.user!;
  const db = ext();

  const at = Date.now();
  const recent = (db._orgCreateRequests?.[user.uuid] ?? []).filter((t) => at - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    throw new MockHttpError(429, 'RATE_LIMITED', 'Too many requests', undefined, Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - at) / 1000)));
  }
  db._orgCreateRequests = { ...db._orgCreateRequests, [user.uuid]: [...recent, at] };

  if (!registrationEnabled()) fail(403, 'FORBIDDEN', 'Self-registration is disabled');

  const name = str(ctx.body.organization_name).trim();
  if (!name) validation([{ field: 'organization_name', message: 'required', code: 'required' }]);
  if (name.length < 2 || name.length > 120) validation([{ field: 'organization_name', message: 'must be between 2 and 120 characters', code: 'length' }]);

  if (db.memberships.some((m) => m.userUuid === user.uuid && m.role === 'owner')) fail(409, 'CONFLICT', 'You already own a business');

  const created = now();
  const org = {
    uuid: uuid(),
    slug: slugFor(name),
    name,
    status: 'active' as const,
    access_ends_at: new Date(at + TRIAL_DAYS * 86400000).toISOString(),
    plan_code: 'trial',
    logo_url: null,
    phone: str(ctx.body.phone).trim(),
    email: user.email,
    address: str(ctx.body.address).trim(),
    city: str(ctx.body.city).trim(),
    district: str(ctx.body.district).trim(),
    created_at: created,
  };
  db.organizations.push(org);
  db.memberships.push({ userUuid: user.uuid, orgUuid: org.uuid, role: 'owner' });
  if (!user.roles.includes('organization_owner')) user.roles = [...user.roles, 'organization_owner'];
  persist();
  log.info('Demo business created', { slug: org.slug });
  return { organization: { uuid: org.uuid, slug: org.slug, name: org.name } };
});
