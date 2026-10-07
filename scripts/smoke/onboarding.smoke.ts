/* Onboarding smoke test: the onboarding state module (intro / first-run flags, settle signal, role
 * bullets), normalizePrice, the mock self-service flow (new Apple identity → zero organizations →
 * create business → owner membership → organization context → starter services), the e-mail-code
 * sign-up path, the error codes of POST /v1/auth/organizations, and that signed-out tenant deep links
 * still go through /link to /login (the intro never sits in front of them). Run via `npm run test:smoke`. */
import { request } from '@/api/client';
import { ApiError, isApiError } from '@/api/errors';
import { installMockTransport } from '@/api/mock';
import { getDb } from '@/api/mock/db';
import { DEMO_IDENTITIES, demoIdToken, getIssuedCodes } from '@/api/mock/demo-auth';
import { session, type Tokens } from '@/api/session';
import { authService } from '@/features/account/services/auth.service';
import type { Gate, Permission } from '@/features/auth/permissions';
import { passwordlessService } from '@/features/auth/services/passwordless.service';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { resolveWebPath, rewriteSystemPath } from '@/features/notifications/deep-links';
import { normalizePrice, STARTER_SERVICES } from '@/features/onboarding/data/starter-services';
import { TR_PROVINCES } from '@/features/onboarding/data/provinces';
import { onboardingService, registrationOpen } from '@/features/onboarding/services/onboarding.service';
import {
  firstRunItems,
  isFirstRunSettled,
  isWelcomePending,
  loadFirstRunSeen,
  loadIntroSeen,
  markDeepLinkReplayed,
  markFirstRunSeen,
  markIntroSeen,
  resetFirstRunSettled,
  resetOnboardingFlags,
  setQaTourForTests,
  setWelcomePending,
  settleFirstRun,
  subscribeIntroReset,
  takeDeepLinkReplayed,
  waitForFirstRunSettled,
} from '@/features/onboarding/state';

// Node built-in, loaded at run time (the app tsconfig has no Node types). Paths are relative to the repo root (cwd).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as { readFileSync: (file: string, encoding: 'utf8') => string };
const readSource = (file: string) => nodeFs.readFileSync(file, 'utf8');

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function expectCode(p: Promise<unknown>, code: string, msg: string) {
  try {
    await p;
    ok(false, `${msg} → success`);
    return null;
  } catch (e) {
    const err = isApiError(e) ? e : null;
    ok(err?.code === code, `${msg} → ${err?.code ?? String(e)}`);
    return err as ApiError | null;
  }
}
const me = () => authService.getMe();
const canFor = (perms: string[], owner: boolean) => (gate: Permission | Gate) => {
  const g: Gate = typeof gate === 'string' ? { perm: gate } : gate;
  if (g.perm && !perms.includes(g.perm)) return false;
  if (g.owner && !owner) return false;
  return true;
};

(async () => {
  await installMockTransport();

  console.log('state: intro');
  ok((await loadIntroSeen()) === false, 'intro not seen on a fresh device');
  await markIntroSeen();
  ok((await loadIntroSeen()) === true, 'intro seen after markIntroSeen');
  let resetHeard = false;
  const unsub = subscribeIntroReset(() => (resetHeard = true));
  await resetOnboardingFlags();
  unsub();
  ok((await loadIntroSeen()) === false && resetHeard, 'reset clears the intro flag and tells the auth provider');
  setQaTourForTests(true);
  ok((await loadIntroSeen()) === true, 'QA tour: intro counts as seen');
  ok((await loadFirstRunSeen('u1', 'org-a')) === true, 'QA tour: first-run counts as seen');
  setQaTourForTests(false);

  console.log('state: first-run');
  ok((await loadFirstRunSeen('u1', 'org-a')) === false, 'first-run not seen');
  await markFirstRunSeen('u1', 'org-a');
  ok((await loadFirstRunSeen('u1', 'org-a')) === true, 'seen for that user + organization');
  ok((await loadFirstRunSeen('u1', 'org-b')) === false, 'other organization still unseen');
  ok((await loadFirstRunSeen('u2', 'org-a')) === false, 'other user still unseen');
  await resetOnboardingFlags();
  ok((await loadFirstRunSeen('u1', 'org-a')) === false, 'reset clears first-run flags');

  const { ROLE_PERMISSIONS } = await import('@/api/mock/handlers/auth');
  const ownerPerms = [...ROLE_PERMISSIONS.organization_user, ...ROLE_PERMISSIONS.organization_owner];
  const ownerItems = firstRunItems(canFor(ownerPerms, true)).map((i) => i.key);
  ok(ownerItems.join() === 'services,staff,jobs', `owner bullets: ${ownerItems.join()}`);
  const staffItems = firstRunItems(canFor(ROLE_PERMISSIONS.organization_user, false)).map((i) => i.key);
  ok(staffItems.join() === 'jobs,qr,assistant', `staff bullets: ${staffItems.join()}`);
  ok(firstRunItems(canFor([], false)).map((i) => i.key).join() === 'qr', 'no permissions: QR sign-in only');
  ok(firstRunItems(canFor(ownerPerms, false)).every((i) => i.key !== 'services' && i.key !== 'staff'), 'owner-only bullets need the owner membership');

  console.log('state: signals');
  resetFirstRunSettled();
  ok(!isFirstRunSettled(), 'settle pending after reset');
  const waiting = waitForFirstRunSettled(5000);
  settleFirstRun();
  ok((await waiting) === true && isFirstRunSettled(), 'waiter resolves when the first-run sheet settles');
  ok((await waitForFirstRunSettled(10)) === true, 'already settled → immediate');
  resetFirstRunSettled();
  ok((await waitForFirstRunSettled(10)) === false, 'safety timeout resolves false');
  ok(takeDeepLinkReplayed() === false, 'no deep link replayed');
  markDeepLinkReplayed();
  ok(takeDeepLinkReplayed() === true && takeDeepLinkReplayed() === false, 'replayed flag is read once');
  setWelcomePending('new-shop');
  ok(isWelcomePending('new-shop') && !isWelcomePending('other') && !isWelcomePending(null), 'welcome pending for that business only');
  setWelcomePending(null);

  console.log('normalizePrice / data');
  const cases: [string, string][] = [
    ['250', '250'],
    ['1.400', '1400'],
    ['1,400', '1400'],
    ['1400,50', '1400.50'],
    ['1.400,50', '1400.50'],
    ['38.000', '38000'],
    ['12,5', '12.5'],
    ['₺ 2.100', '2100'],
    ['', ''],
  ];
  for (const [raw, want] of cases) ok(normalizePrice(raw) === want, `normalizePrice(${JSON.stringify(raw)}) = ${normalizePrice(raw)}`);
  ok(TR_PROVINCES.length === 81, '81 provinces');
  ok(STARTER_SERVICES.filter((s) => s.selected).length === 4, '4 starter services preselected (web parity)');

  console.log('mock: new Apple owner → create business');
  const config = await onboardingService.appConfig();
  ok(config.registration_enabled === true && registrationOpen(config), 'app config: registration enabled');
  ok(registrationOpen(undefined) && !registrationOpen({ registration_enabled: false }), 'registrationOpen: unknown → open, false → closed');
  const identity = DEMO_IDENTITIES.find((i) => i.sub === 'apple-new-owner')!;
  ok(Boolean(identity) && !identity.linkedTo && !identity.email.endsWith('@privaterelay.appleid.com'), 'demo identity "Apple – new owner, no business" exists');
  const tokens: Tokens = await passwordlessService.nativeOAuth('apple', { id_token: demoIdToken(identity, 'n-new'), nonce: 'n-new' });
  await session.setTokens(tokens, null);
  const fresh = await me();
  ok((fresh.organizations ?? []).length === 0, 'new Apple user is signed in with zero organizations');
  await expectCode(onboardingService.createOrganization({ organization_name: 'X' }), 'VALIDATION_ERROR', 'one-letter name');
  await expectCode(onboardingService.createOrganization({ organization_name: 'x'.repeat(121) }), 'VALIDATION_ERROR', '121-letter name');
  await expectCode(request('POST', '/v1/tenant/catalog/services', { body: { name: 'x' }, silent: true }), 'ORGANIZATION_CONTEXT_REQUIRED', 'no tenant access before a business exists');
  const created = await onboardingService.createOrganization({ organization_name: 'Selin Oto Kuaför', phone: '0532 000 00 00', city: 'İzmir', district: 'Karşıyaka', address: 'Cemal Gürsel Cad. 1' });
  ok(/^selin-oto-kuafor/.test(created.organization.slug) && created.organization.name === 'Selin Oto Kuaför', `201 → slug ${created.organization.slug}`);
  const org = getDb().organizations.find((o) => o.uuid === created.organization.uuid)!;
  const trialDays = (new Date(org.access_ends_at!).getTime() - Date.now()) / 86400000;
  ok(org.plan_code === 'trial' && trialDays > 13.9 && trialDays <= 14, 'new business has a 14-day trial');
  await expectCode(onboardingService.createOrganization({ organization_name: 'İkinci İşletme' }), 'CONFLICT', 'second business → 409');
  const after = await me();
  const membership = after.organizations?.find((o) => o.slug === created.organization.slug);
  ok(membership?.role === 'owner', 'refetched /me lists the business with role owner');
  const ctxTokens = await authService.switchOrganizationContext(created.organization.slug);
  await session.setTokens(ctxTokens, created.organization.slug);
  const scoped = await me();
  ok(scoped.permissions?.includes('tenant.catalog.write') && scoped.permissions?.includes('tenant.staff.write'), 'organization context carries owner permissions');
  const picked = STARTER_SERVICES.filter((s) => s.selected);
  const results = await Promise.allSettled(picked.map((s) => catalogService.createService({ name: s.name, price: normalizePrice(s.price) || '0', currency: 'TRY', is_active: true })));
  ok(results.every((r) => r.status === 'fulfilled'), `starter services created (${results.length})`);
  const interior = results.find((r) => r.status === 'fulfilled' && r.value.name === 'Detaylı iç temizlik');
  ok(interior?.status === 'fulfilled' && Number(interior.value.price) === 1400, 'price normalized on the way in');

  console.log('mock: e-mail code sign-up, 403, 429, 401');
  await session.clear('test');
  await expectCode(onboardingService.createOrganization({ organization_name: 'Anon' }), 'UNAUTHENTICATED', 'signed out → 401');
  const email = 'yeni.sahip@example.com';
  await passwordlessService.requestEmailCode(email);
  const code = getIssuedCodes().find((c) => c.email === email)?.code ?? '';
  ok(/^\d{6}$/.test(code), 'unknown e-mail gets a code');
  await expectCode(passwordlessService.verifyEmailCode(email, '000000'), 'INVALID_EMAIL_CODE', 'wrong code still refused');
  await session.setTokens(await passwordlessService.verifyEmailCode(email, code), null);
  const byCode = await me();
  ok(byCode.user.email === email && (byCode.organizations ?? []).length === 0, 'verify creates the account, signed in with zero organizations');
  const db = getDb() as ReturnType<typeof getDb> & { _registrationEnabled?: boolean };
  db._registrationEnabled = false;
  ok(registrationOpen(await onboardingService.appConfig()) === false, 'app config reports registration disabled');
  await expectCode(onboardingService.createOrganization({ organization_name: 'Kapalı Kayıt' }), 'FORBIDDEN', 'self-registration disabled → 403');
  await passwordlessService.requestEmailCode('kapali@example.com');
  const closedCode = getIssuedCodes().find((c) => c.email === 'kapali@example.com')?.code ?? '';
  await expectCode(passwordlessService.verifyEmailCode('kapali@example.com', closedCode), 'FORBIDDEN', 'e-mail sign-up with registration disabled → 403');
  db._registrationEnabled = true;
  // The 403 above was attempt 1 of 5 per hour.
  for (let i = 0; i < 4; i++) await expectCode(onboardingService.createOrganization({ organization_name: '' }), 'VALIDATION_ERROR', `attempt ${i + 2} (empty name)`);
  const limited = await expectCode(onboardingService.createOrganization({ organization_name: 'Altıncı' }), 'RATE_LIMITED', '6th attempt within the hour → 429');
  ok(limited?.status === 429, '429 status');

  console.log('deep links while signed out');
  const rewritten = rewriteSystemPath('https://otopoly.app/t/parlak-oto/jobs');
  ok(rewritten.startsWith('/link?to='), `tenant link goes through /link (${rewritten})`);
  ok(resolveWebPath('/t/parlak-oto/jobs')?.kind === 'tenant', 'resolves as a tenant link (link screen → /login when signed out)');
  const linkScreen = readSource('src/app/link.tsx');
  ok(/status === 'signedOut'[\s\S]{0,120}go\('\/login'\)/.test(linkScreen), 'link screen still sends signed-out users to /login');
  const authLayout = readSource('src/app/(auth)/_layout.tsx');
  const authIndex = readSource('src/app/(auth)/index.tsx');
  ok(authLayout.includes("anchor: 'index'") && authLayout.includes('name="index"'), 'auth group has a concrete index anchor');
  ok(authIndex.includes("introSeen ? '/login' : '/welcome'"), 'auth index sends new users to welcome and returning signed-out users to login');
  const guarded = /<Stack\.Protected guard=\{!introSeen\}>([\s\S]*?)<\/Stack\.Protected>/.exec(authLayout)?.[1] ?? '';
  ok(guarded.includes('name="welcome"') && !guarded.includes('name="login"') && authLayout.includes('<Stack.Screen name="login" />'), 'only the intro is guarded; /login is always reachable');

  console.log(failures ? `${failures} FAILED` : 'onboarding smoke: all passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
