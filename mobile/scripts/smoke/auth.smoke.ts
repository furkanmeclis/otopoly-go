/* Passwordless sign-in smoke test: e-mail code, native Apple / Google, private-relay linking and
 * account deletion through the real client against the mock, covering every success and error
 * code of docs/backend/WAVE1_CONTRACTS.md. Run via `npm run test:smoke`. */
import { request } from '@/api/client';
import { ApiError, isApiError } from '@/api/errors';
import { installMockTransport } from '@/api/mock';
import { getDb } from '@/api/mock/db';
import { DEMO_EMAIL_CODE, DEMO_IDENTITIES, DEMO_TOTP_CODE, demoIdToken, getIssuedCodes } from '@/api/mock/demo-auth';
import { session, type Tokens } from '@/api/session';
import { authErrorMessage, linkChoiceFrom } from '@/features/auth/lib/auth-errors';
import { passwordlessService as api } from '@/features/auth/services/passwordless.service';
import { translate } from '@/lib/i18n/translate';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function caught(p: Promise<unknown>): Promise<ApiError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return isApiError(e) ? e : null;
  }
}
async function expectCode(p: Promise<unknown>, code: string, msg: string) {
  const e = await caught(p);
  ok(e?.code === code, `${msg} → ${e?.code ?? 'success'}`);
  return e;
}
const me = () => request<any>('GET', '/v1/auth/me', { silent: true });
async function signedIn(tokens: Tokens) {
  await session.setTokens(tokens, null);
  return me();
}
const identity = (sub: string) => DEMO_IDENTITIES.find((i) => i.sub === sub)!;
const idt = (sub: string, nonce?: string) => ({ id_token: demoIdToken(identity(sub), nonce), ...(nonce ? { nonce } : {}) });
const lastCode = (email: string) => getIssuedCodes().find((c) => c.email === email)?.code ?? '';
const tr = (key: string, params?: Record<string, string | number>) => translate('tr', key, params);
const en = (key: string, params?: Record<string, string | number>) => translate('en', key, params);

(async () => {
  await installMockTransport();
  const generic = tr('common.error_generic');

  console.log('email code');
  ok((await api.requestEmailCode('demo@otopoly.com')).status === 'accepted', 'request accepted (account)');
  ok((await api.requestEmailCode('nobody@example.com')).status === 'accepted', 'request accepted (no account, no enumeration)');
  await expectCode(api.requestEmailCode('not-an-email'), 'VALIDATION_ERROR', 'malformed email');
  await expectCode(api.verifyEmailCode('demo@otopoly.com', '000000'), 'INVALID_EMAIL_CODE', 'wrong code');
  await expectCode(api.verifyEmailCode('nobody@example.com', DEMO_EMAIL_CODE), 'INVALID_EMAIL_CODE', 'no account');
  await expectCode(
    request('POST', '/v1/auth/email-code/verify', { anonymous: true, silent: true, body: { email: 'demo@otopoly.com', code: DEMO_EMAIL_CODE, organization_slug: 'nope' } }),
    'NO_TENANT_MEMBERSHIP',
    'unknown organization_slug',
  );
  const owner = await signedIn(await api.verifyEmailCode('demo@otopoly.com', DEMO_EMAIL_CODE));
  ok(owner.user.email === 'demo@otopoly.com', 'fixed review code signs in');
  await expectCode(api.verifyEmailCode('demo@otopoly.com', DEMO_EMAIL_CODE), 'INVALID_EMAIL_CODE', 'code is single use');

  await api.requestEmailCode('personel@otopoly.com');
  for (let i = 0; i < 5; i++) await caught(api.verifyEmailCode('personel@otopoly.com', '111111'));
  await expectCode(api.verifyEmailCode('personel@otopoly.com', DEMO_EMAIL_CODE), 'INVALID_EMAIL_CODE', '5 wrong attempts exhaust the code');

  await api.requestEmailCode('hasan@parlakoto.com');
  const random = lastCode('hasan@parlakoto.com');
  ok(/^\d{6}$/.test(random) && random !== DEMO_EMAIL_CODE, `random code recorded for diagnostics (${random})`);
  const disabled = await expectCode(api.verifyEmailCode('hasan@parlakoto.com', random), 'FORBIDDEN', 'admin-disabled account');
  ok(disabled && authErrorMessage(tr, disabled) === tr('mobile.auth.error.account_disabled'), 'disabled copy');

  console.log('email code + TOTP');
  await api.requestEmailCode('ali@parlakoto.com');
  await expectCode(api.verifyEmailCode('ali@parlakoto.com', DEMO_EMAIL_CODE), 'MFA_REQUIRED', 'TOTP user needs authenticator');
  const badMfa = await expectCode(api.verifyEmailCode('ali@parlakoto.com', DEMO_EMAIL_CODE, '999999'), 'INVALID_MFA_CODE', 'wrong TOTP');
  ok(badMfa?.status === 401, 'INVALID_MFA_CODE is 401');
  const ali = await signedIn(await api.verifyEmailCode('ali@parlakoto.com', DEMO_EMAIL_CODE, DEMO_TOTP_CODE));
  ok(ali.user.email === 'ali@parlakoto.com', 'same code + TOTP signs in');
  await expectCode(request('POST', '/v1/auth/login', { anonymous: true, silent: true, body: { email: 'ali@parlakoto.com', password: 'demo1234' } }), 'MFA_REQUIRED', 'password login asks for TOTP too');

  console.log('rate limit');
  for (let i = 0; i < 4; i++) await api.requestEmailCode('rate@example.com');
  await api.requestEmailCode('rate@example.com');
  const limited = await expectCode(api.requestEmailCode('rate@example.com'), 'RATE_LIMITED', '6th request in 15 min');
  ok(limited?.status === 429 && (limited.retryAfter ?? 0) > 0, `Retry-After ${limited?.retryAfter}s`);
  ok(limited && authErrorMessage(tr, limited).includes('dakika'), `rate-limit copy: ${limited && authErrorMessage(tr, limited)}`);

  console.log('native Apple / Google');
  const linked = await signedIn(await api.nativeOAuth('apple', { ...idt('apple-linked', 'n1'), authorization_code: 'c1' }));
  ok(linked.user.email === 'demo@otopoly.com', 'linked Apple identity signs in');
  await expectCode(api.nativeOAuth('apple', { id_token: demoIdToken(identity('apple-linked'), 'n1'), nonce: 'other' }), 'INVALID_ID_TOKEN', 'nonce mismatch');
  await expectCode(api.nativeOAuth('apple', { id_token: 'garbage' }), 'INVALID_ID_TOKEN', 'unverifiable token');
  await expectCode(api.nativeOAuth('google', idt('apple-linked')), 'INVALID_ID_TOKEN', 'token from another provider');
  await expectCode(api.nativeOAuth('apple', { id_token: '' }), 'VALIDATION_ERROR', 'missing id_token');
  const notLinked = await expectCode(api.nativeOAuth('google', idt('google-unlinked')), 'OAUTH_ACCOUNT_NOT_LINKED', 'Google email has an unlinked account');
  ok(notLinked?.status === 409 && authErrorMessage(tr, notLinked, 'google').includes('Bağlı hesaplar'), 'not-linked copy points to Profile → Bağlı hesaplar');
  (getDb() as any)._oauthDisabled = { google: true };
  await expectCode(api.nativeOAuth('google', idt('google-unlinked')), 'OAUTH_PROVIDER_DISABLED', 'provider disabled');
  (getDb() as any)._oauthDisabled = {};

  console.log('private relay: registration closed');
  const closedErr = await expectCode(api.nativeOAuth('apple', { ...idt('apple-relay-closed'), given_name: 'Ece' }), 'OAUTH_LINK_CHOICE_REQUIRED', 'relay without account');
  const closed = linkChoiceFrom(closedErr);
  ok(closed && closed.provider === 'apple' && closed.expiresIn === 900 && closed.registerAllowed === false, 'details parsed (register_allowed=false)');
  await expectCode(api.createFromLink(closed!.linkTicket), 'FORBIDDEN', 'link/create with registration closed');
  await expectCode(api.requestLinkCode('mock-lt.tampered', 'ali@parlakoto.com'), 'INVALID_LINK_TICKET', 'link/request bad ticket');
  await expectCode(api.verifyLink('mock-lt.tampered', 'ali@parlakoto.com', DEMO_EMAIL_CODE), 'INVALID_LINK_TICKET', 'link/verify bad ticket');
  ok((await api.requestLinkCode(closed!.linkTicket, 'demo@otopoly.com')).status === 'accepted', 'link/request accepted');
  await expectCode(api.verifyLink(closed!.linkTicket, 'demo@otopoly.com', DEMO_EMAIL_CODE), 'CONFLICT', 'account already has an Apple identity');
  await api.requestLinkCode(closed!.linkTicket, 'ali@parlakoto.com');
  await expectCode(api.verifyLink(closed!.linkTicket, 'ali@parlakoto.com', '123123'), 'INVALID_EMAIL_CODE', 'link/verify wrong code');
  await expectCode(api.verifyLink(closed!.linkTicket, 'ali@parlakoto.com', DEMO_EMAIL_CODE), 'MFA_REQUIRED', 'link/verify asks for TOTP');
  await expectCode(api.verifyLink(closed!.linkTicket, 'ali@parlakoto.com', DEMO_EMAIL_CODE, '000000'), 'INVALID_MFA_CODE', 'link/verify wrong TOTP');
  const linkedAli = await signedIn(await api.verifyLink(closed!.linkTicket, 'ali@parlakoto.com', DEMO_EMAIL_CODE, DEMO_TOTP_CODE));
  ok(linkedAli.user.email === 'ali@parlakoto.com', 'link/verify links and signs in');
  await expectCode(api.nativeOAuth('apple', idt('apple-relay-closed')), 'MFA_REQUIRED', 'relay identity now signs into the linked account (TOTP)');

  console.log('private relay: new account');
  const relayErr = await expectCode(api.nativeOAuth('apple', idt('apple-relay-new')), 'OAUTH_LINK_CHOICE_REQUIRED', 'relay without account');
  const relay = linkChoiceFrom(relayErr);
  ok(relay?.registerAllowed === true, 'register_allowed=true');
  const created = await signedIn(await api.createFromLink(relay!.linkTicket));
  ok(created.user.email.endsWith('@privaterelay.appleid.com') && created.user.name === 'Deniz' && created.organizations.length === 0, 'link/create makes the account (no business yet)');
  const again = await signedIn(await api.createFromLink(relay!.linkTicket));
  ok(again.user.uuid === created.user.uuid, 'link/create retry signs into the same account');
  const relaySignIn = await signedIn(await api.nativeOAuth('apple', idt('apple-relay-new')));
  ok(relaySignIn.user.uuid === created.user.uuid, 'relay identity is linked afterwards');

  console.log('account deletion');
  getDb().users.find((u) => u.uuid === created.user.uuid)!.isSuperAdmin = true;
  await api.requestDeactivationCode();
  await expectCode(api.deactivate(lastCode(created.user.email)), 'CONFLICT', 'last super admin cannot deactivate');

  await signedIn(await api.verifyEmailCode('personel@otopoly.com', (await api.requestEmailCode('personel@otopoly.com'), DEMO_EMAIL_CODE)));
  const refresh = session.get()!.refreshToken;
  await expectCode(api.deactivate(''), 'STEP_UP_REQUIRED', 'no code and no step-up');
  ok((await api.requestDeactivationCode()).status === 'accepted', 'deactivation code e-mailed');
  ok(lastCode('personel@otopoly.com') === DEMO_EMAIL_CODE && getIssuedCodes()[0].purpose === 'deactivate', 'code recorded as deactivation');
  await expectCode(api.deactivate('000000'), 'INVALID_EMAIL_CODE', 'wrong deactivation code');
  ok((await api.deactivate(DEMO_EMAIL_CODE)).status === 'scheduled', 'account deletion scheduled');
  await expectCode(me(), 'UNAUTHENTICATED', 'existing access token stops working');
  await expectCode(request('POST', '/v1/auth/refresh', { anonymous: true, silent: true, body: { refresh_token: refresh } }), 'UNAUTHENTICATED', 'refresh sessions revoked');
  const deact = await expectCode(request('POST', '/v1/auth/login', { anonymous: true, silent: true, body: { email: 'personel@otopoly.com', password: 'demo1234' } }), 'ACCOUNT_DEACTIVATED', 'password login');
  ok(deact && authErrorMessage(tr, deact).includes('kurtarabilirsiniz') && authErrorMessage(en, deact).includes('deleted'), 'deactivated copy (tr/en)');
  ok((await api.requestEmailCode('personel@otopoly.com')).status === 'accepted', 'code request still accepted');
  await expectCode(api.verifyEmailCode('personel@otopoly.com', DEMO_EMAIL_CODE), 'ACCOUNT_DEACTIVATED', 'email code login');
  const org = getDb().organizations[0];
  ok(getDb().memberships.some((m) => m.orgUuid === org.uuid), 'organization data kept');

  await signedIn(await api.verifyEmailCode('demo@otopoly.com', (await api.requestEmailCode('demo@otopoly.com'), DEMO_EMAIL_CODE)));
  for (let i = 0; i < 5; i++) await api.requestDeactivationCode();
  await expectCode(api.requestDeactivationCode(), 'RATE_LIMITED', 'deactivation code: 5 per 15 minutes');

  console.log('copy');
  for (const code of ['INVALID_EMAIL_CODE', 'INVALID_MFA_CODE', 'ACCOUNT_DEACTIVATED', 'INVALID_ID_TOKEN', 'OAUTH_PROVIDER_DISABLED', 'OAUTH_ACCOUNT_NOT_LINKED', 'INVALID_LINK_TICKET', 'CONFLICT', 'RATE_LIMITED', 'NO_TENANT_MEMBERSHIP', 'FORBIDDEN']) {
    const e = new ApiError({ status: 400, code, message: 'x' });
    for (const t of [tr, en]) {
      const m = authErrorMessage(t, e, 'apple');
      ok(m && m !== generic && m !== en('common.error_generic') && !m.includes('{{'), `${code}: ${m}`);
    }
  }

  console.log(failures ? `${failures} FAILURE(S)` : 'ALL AUTH CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
