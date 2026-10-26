/* Sign-up + first-run smoke test: password sign-up (POST /v1/auth/register → e-mail code), code-only
 * sign-up with the name saved afterwards, existing accounts, the password policy helper, the
 * getting-started checklist store, sector templates, the logo upload, the "forward to create business"
 * signal and the assistant deep link. Run via `npm run test:smoke`. */
import { isApiError } from '@/api/errors';
import { installMockTransport, mockFormRequest } from '@/api/mock';
import { getIssuedCodes } from '@/api/mock/demo-auth';
import { session } from '@/api/session';
import { authService } from '@/features/account/services/auth.service';
import type { Gate, Permission } from '@/features/auth/permissions';
import { passwordlessService } from '@/features/auth/services/passwordless.service';
import { isFreshCodeAccount, passwordValid, registerService } from '@/features/auth/services/register.service';
import { resolveWebPath } from '@/features/notifications/deep-links';
import { SECTOR_KEYS, servicesFor } from '@/features/onboarding/data/sectors';
import { onboardingService } from '@/features/onboarding/services/onboarding.service';
import { EMPTY_SETUP, isComplete, loadSetup, reopenSetup, saveSetup, setupItems, setupProgress, subscribeSetup, withObserved } from '@/features/onboarding/setup';
import { resetOnboardingFlags, takeCreateBusinessForward } from '@/features/onboarding/state';
import { prefs, StorageKeys } from '@/lib/storage';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function expectCode(p: Promise<unknown>, code: string, msg: string) {
  try {
    await p;
    ok(false, `${msg} → success`);
  } catch (e) {
    ok(isApiError(e) && e.code === code, `${msg} → ${isApiError(e) ? e.code : String(e)}`);
  }
}
const lastCode = (email: string) => getIssuedCodes().find((c) => c.email === email && c.purpose === 'login')?.code ?? '';
const canFor = (perms: string[], owner: boolean) => (gate: Permission | Gate) => {
  const g: Gate = typeof gate === 'string' ? { perm: gate } : gate;
  if (g.perm && !perms.includes(g.perm)) return false;
  if (g.owner && !owner) return false;
  return true;
};

(async () => {
  await installMockTransport();

  console.log('password policy');
  ok(passwordValid('Guclu1234') && !passwordValid('guclu1234') && !passwordValid('GUCLU1234') && !passwordValid('Gucluuuuu') && !passwordValid('Gu1'), 'backend rules: 8+, lower, upper, digit');

  console.log('sign-up with a password');
  const config = await onboardingService.appConfig();
  ok(config.auth_methods.password.register === true, 'app config: password sign-up allowed in the demo');
  const email = 'kayit.sifre@example.com';
  await expectCode(registerService.register({ email, password: 'zayif', name: 'Ayşe', surname: 'Kaya' }), 'VALIDATION_ERROR', 'weak password');
  await expectCode(registerService.register({ email, password: 'Guclu1234', name: '', surname: 'Kaya' }), 'VALIDATION_ERROR', 'missing name');
  const reg = await registerService.register({ email, password: 'Guclu1234', name: 'Ayşe', surname: 'Kaya' });
  ok(reg.user.email === email && reg.user.name === 'Ayşe', '201 → user, no tokens');
  await expectCode(registerService.register({ email, password: 'Guclu1234', name: 'Ayşe', surname: 'Kaya' }), 'CONFLICT', 'same e-mail again');
  await expectCode(registerService.register({ email: 'demo@otopoly.com', password: 'Guclu1234', name: 'X', surname: 'Y' }), 'CONFLICT', 'existing demo account');
  await passwordlessService.requestEmailCode(email);
  await session.setTokens(await passwordlessService.verifyEmailCode(email, lastCode(email)), null);
  const withPw = await authService.getMe();
  ok(withPw.user.name === 'Ayşe' && withPw.user.surname === 'Kaya' && !(withPw.organizations?.length ?? 0), 'code verifies and signs in, name kept, no business yet');
  ok(!isFreshCodeAccount(withPw), 'a password sign-up is not mistaken for a bare code account');
  const pwTokens = await authService.login({ email, password: 'Guclu1234' });
  ok(Boolean(pwTokens.access_token), 'the password works for later sign-ins');

  console.log('sign-up with an e-mail code only');
  await session.clear('test');
  const email2 = 'kod.kayit@example.com';
  await passwordlessService.requestEmailCode(email2);
  await session.setTokens(await passwordlessService.verifyEmailCode(email2, lastCode(email2)), null);
  const bare = await authService.getMe();
  ok(isFreshCodeAccount(bare), 'fresh code account detected (local-part name, no surname, no business)');
  const named = await authService.updateProfile({ name: 'Mehmet', surname: 'Demir', locale: 'tr' });
  ok(named.user.name === 'Mehmet' && named.user.surname === 'Demir' && !isFreshCodeAccount(named), 'typed name saved after sign-up');

  console.log('existing account through the sign-up code path');
  await session.clear('test');
  await passwordlessService.requestEmailCode('demo@otopoly.com');
  await session.setTokens(await passwordlessService.verifyEmailCode('demo@otopoly.com', lastCode('demo@otopoly.com')), null);
  const existing = await authService.getMe();
  ok(!isFreshCodeAccount(existing) && (existing.organizations?.length ?? 0) > 0, 'existing account signs in untouched (profile not overwritten)');
  await session.clear('test');
  await passwordlessService.requestEmailCode('ali@parlakoto.com');
  await expectCode(passwordlessService.verifyEmailCode('ali@parlakoto.com', lastCode('ali@parlakoto.com')), 'MFA_REQUIRED', 'existing account with 2FA asks for the authenticator');

  console.log('create business → logo');
  await session.clear('test');
  await session.setTokens(await authService.login({ email, password: 'Guclu1234' }), null);
  const created = await onboardingService.createOrganization({ organization_name: 'Ayşe Detailing', phone: '05320000000', city: 'Ankara' });
  await session.setTokens(await authService.switchOrganizationContext(created.organization.slug), created.organization.slug);
  // Same multipart call as exportSettingsService.uploadLogo (files.ts needs native modules, so the mock form path directly).
  const form = new FormData();
  form.append('logo', 'file:///logo.png');
  const settings = await mockFormRequest<{ logo_url: string | null }>('PUT', '/v1/tenant/settings/logo', form);
  ok(Boolean(settings.logo_url), 'letterhead logo uploaded with the new organization token');

  console.log('sector templates');
  for (const key of SECTOR_KEYS) ok(servicesFor(key, 'tr').length > 0 && servicesFor(key, 'en').every((s) => s.name && s.price), `${key}: services in tr + en`);
  ok(servicesFor('other', 'tr').every((s) => !s.selected), '"other" preselects nothing');
  ok(servicesFor('tyres', 'en')[0].name !== servicesFor('tyres', 'tr')[0].name, 'names follow the app language');

  console.log('getting-started checklist');
  const ownerPerms = ['tenant.catalog.write', 'tenant.customers.write', 'tenant.jobs.write', 'tenant.sales.write', 'tenant.messaging.write', 'tenant.staff.write', 'tenant.contracts.write'];
  ok(setupItems(canFor(ownerPerms, true)).map((i) => i.key).join() === 'services,customer,job,sale,whatsapp,staff,contract', 'owner sees every step');
  ok(setupItems(canFor(ownerPerms, false)).map((i) => i.key).join() === 'customer,job,sale,contract', 'staff sees only steps they can do');
  const items = setupItems(canFor(ownerPerms, true));
  const s1 = withObserved(EMPTY_SETUP, { services: true, customer: false });
  ok(s1 !== EMPTY_SETUP && s1.done.services && !s1.done.customer, 'observed step marked done');
  ok(withObserved(s1, { services: false }) === s1, 'done is sticky and unchanged state is the same object');
  ok(setupProgress({ ...s1, skipped: { staff: true } }, items).done === 2 && isComplete({ ...s1, skipped: { staff: true } }, 'staff'), 'skipped steps count as handled');
  let heard = 0;
  const unsub = subscribeSetup(() => heard++);
  await saveSetup('u1', 'org1', { ...s1, dismissed: true });
  ok((await loadSetup('u1', 'org1')).dismissed && heard === 1, 'stored per user + organization, listeners told');
  ok(!(await loadSetup('u1', 'org2')).dismissed && !(await loadSetup('u2', 'org1')).dismissed, 'other organization / user unaffected');
  await reopenSetup('u1', 'org1');
  const reopened = await loadSetup('u1', 'org1');
  ok(!reopened.dismissed && reopened.done.services, 'menu brings the card back, finished steps stay finished');
  unsub();
  await prefs.set(`${StorageKeys.dismissedSetup}.legacy-org`, true);
  ok((await loadSetup('u1', 'legacy-org')).dismissed, 'card hidden with the old per-organization flag stays hidden');

  console.log('forward to create business');
  await resetOnboardingFlags();
  ok(takeCreateBusinessForward() && !takeCreateBusinessForward(), 'once per launch');

  console.log('assistant deep links');
  ok(resolveWebPath('/t/parlak-oto/assistant')?.href === '/assistant', 'list');
  ok(resolveWebPath('/t/parlak-oto/assistant?c=abc-123')?.href === '/assistant/abc-123', 'web ?c= opens the conversation screen');

  console.log(failures ? `${failures} FAILED` : 'signup smoke: all passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
