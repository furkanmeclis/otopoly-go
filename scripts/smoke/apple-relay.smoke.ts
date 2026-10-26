/* Apple "Hide my email" → "No, create a new account" (TestFlight report 2026-10: it never finished).
 * Drives the real sign-in flow (lib/sign-in-flow.ts) and the auth provider's sign-in steps
 * (lib/complete-sign-in.ts) against the mock, with a model of what the screens do around them:
 *  - the "Hesabım var mı?" sheet is a native modal on the login screen: it needs time to animate out,
 *    and the navigator must not switch (Stack.Protected) while it is still on screen,
 *  - the organization picker forwards a business-less account to the wizard once, without a bounce.
 * Also: double tap, the same Apple ID again, registration closed, a relay account that lost its
 * identity, a sign-in whose session cannot be opened (loop guard), Google and "link existing account".
 * Run via `npm run test:smoke`. */
import { installMockTransport } from '@/api/mock';
import { getDb } from '@/api/mock/db';
import { DEMO_EMAIL_CODE, DEMO_IDENTITIES, demoIdToken } from '@/api/mock/demo-auth';
import { session, type Tokens } from '@/api/session';
import { authService, type Me } from '@/features/account/services/auth.service';
import { signInFailureMessage } from '@/features/auth/lib/auth-errors';
import { completeSignInSteps, entryFor, type SignInOptions } from '@/features/auth/lib/complete-sign-in';
import { createSignInFlow, type SignInAttempt } from '@/features/auth/lib/sign-in-flow';
import { createRepeatGuard, getSignInNotice, markSignedIn, noteSessionLost } from '@/features/auth/lib/sign-in-guard';
import { passwordlessService as api } from '@/features/auth/services/passwordless.service';
import { onboardingService } from '@/features/onboarding/services/onboarding.service';
import { resetCreateBusinessForward, takeCreateBusinessForward } from '@/features/onboarding/state';
import { translate } from '@/lib/i18n/translate';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
const tr = (key: string, params?: Record<string, string | number>) => translate('tr', key, params);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const identity = (sub: string) => DEMO_IDENTITIES.find((i) => i.sub === sub)!;
const appleToken = (sub: string) => ({ id_token: demoIdToken(identity(sub)) });

type MockExt = { _oauthIdentities?: { provider: string; sub: string; userUuid: string }[] };
const mockExt = () => getDb() as unknown as MockExt;
/** The mock has two relay identities: make one brand new again (no account, no identity). */
function forgetRelayAccount(sub: string) {
  const email = identity(sub).email;
  mockExt()._oauthIdentities = (mockExt()._oauthIdentities ?? []).filter((i) => i.sub !== sub);
  const db = getDb();
  db.users = db.users.filter((u) => u.email.toLowerCase() !== email);
}

type Status = 'signedOut' | 'selectOrg' | 'ready';
const SHEET_ANIMATION_MS = 40;

/** The parts of AuthProvider + RootNavigator + login / select-org screens the flow interacts with. */
function createApp() {
  const app = {
    status: 'signedOut' as Status,
    /** Every navigator switch, with what the login screen still had on screen at that moment. */
    switches: [] as { to: Status; sheetOnScreen: boolean }[],
    /** Organization-less stack: the picker, the wizard pushed on top. */
    stack: [] as string[],
    completions: 0,
    resets: [] as string[],
    failProfileLoads: 0,
    /** Entering / opening the account fails after the profile loaded (e.g. organization context). */
    failRoute: false,
    profile: null as Me | null,
  };
  // The sheet: visible while `linkChoice` is set; once hidden it stays on screen for its animation,
  // then reports `onDismissed` (iOS) to the flow.
  const sheet = { visible: false, onScreen: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };

  const setStatus = (to: Status) => {
    if (app.status === to) return;
    app.status = to;
    app.switches.push({ to, sheetOnScreen: sheet.onScreen });
    app.stack = to === 'selectOrg' ? ['select-org'] : [];
    if (to === 'selectOrg') focusPicker();
  };
  /** select-org's focus effect. */
  const focusPicker = () => {
    const none = (app.profile?.organizations ?? []).length === 0;
    if (none && takeCreateBusinessForward()) app.stack.push('create-business');
  };
  const back = () => {
    app.stack.pop();
    if (app.stack.at(-1) === 'select-org') focusPicker();
  };
  const reset = async (reason: string) => {
    app.resets.push(reason);
    await session.clear(reason);
    app.profile = null;
    setStatus('signedOut');
  };
  const route = async (profile: Me) => {
    if (app.failRoute) throw new Error('route failed');
    const entry = entryFor(profile, null);
    if (entry.kind === 'enter') {
      await session.setTokens(await authService.switchOrganizationContext(entry.slug), entry.slug);
      app.profile = await authService.getMe();
      setStatus('ready');
    } else {
      app.profile = profile;
      setStatus('selectOrg');
    }
  };
  const completeSignIn = (tokens: Tokens, options?: SignInOptions) => {
    app.completions++;
    return completeSignInSteps(
      {
        storeTokens: (pair) => {
          resetCreateBusinessForward();
          markSignedIn();
          return session.setTokens(pair, null);
        },
        loadProfile: async () => {
          if (app.failProfileLoads > 0) {
            app.failProfileLoads--;
            throw new Error('profile load failed');
          }
          return authService.getMe();
        },
        syncLocale: () => {},
        route,
        reset,
        signedIn: () => {},
      },
      tokens,
      options,
    );
  };
  const flow = createSignInFlow(
    { completeSignIn, message: (error, provider, kind) => signInFailureMessage(tr, error, provider, kind), setLinkIntent: () => {} },
    { sheetDismissTimeoutMs: 500 },
  );
  flow.subscribe(() => {
    const visible = Boolean(flow.getState().linkChoice);
    if (visible === sheet.visible) return;
    sheet.visible = visible;
    clearTimeout(sheet.timer);
    if (visible) sheet.onScreen = true;
    else
      sheet.timer = setTimeout(() => {
        sheet.onScreen = false;
        flow.sheetDismissed();
      }, SHEET_ANIMATION_MS);
  });
  const signOut = async () => {
    await reset('logout');
    app.switches = [];
  };
  return { app, flow, sheet, back, signOut };
}

async function expectChoice(flow: ReturnType<typeof createApp>['flow'], attempt: SignInAttempt) {
  const message = await flow.run(attempt, 'apple');
  const choice = flow.getState().linkChoice;
  ok(message === null && choice !== null, `relay sign-in asks "Hesabım var mı?" (${message ?? 'choice'})`);
  return choice!;
}

(async () => {
  await installMockTransport();

  console.log('relay → create a new account → business wizard');
  {
    const { app, flow, sheet, back } = createApp();
    const choice = await expectChoice(flow, () => api.nativeOAuth('apple', appleToken('apple-relay-new')));
    ok(choice.registerAllowed && app.status === 'signedOut', 'choice offers a new account; still signed out');
    ok(sheet.onScreen, 'sheet on screen');

    // "No, create a new account" — tapped twice.
    const [first, second] = await Promise.all([
      flow.run(() => api.createFromLink(choice.linkTicket), 'apple'),
      flow.run(() => api.createFromLink(choice.linkTicket), 'apple'),
    ]);
    ok(first === null && second === null, 'create succeeds');
    ok(app.completions === 1, `double tap opens the session once (${app.completions})`);
    ok(app.status === 'selectOrg', `signed in without a business → organization picker (${app.status})`);
    ok(app.switches.length === 1 && app.switches.every((s) => !s.sheetOnScreen), `sheet fully closed before the navigator switch (${JSON.stringify(app.switches)})`);
    const state = flow.getState();
    ok(state.linkChoice === null && !state.busy && state.mfa === null && state.notice === null, 'flow state cleared (no sheet, not busy)');
    ok(app.stack.join('>') === 'select-org>create-business', `picker forwards to the wizard (${app.stack.join('>')})`);
    back();
    ok(app.stack.join('>') === 'select-org', 'back from the wizard shows the picker, no bounce');
    ok(app.resets.length === 0, 'no sign-out along the way');

    const me = await authService.getMe();
    ok(me.user.email.endsWith('@privaterelay.appleid.com') && (me.organizations ?? []).length === 0, 'account has the relay address, no business yet');

    console.log('create the business → organization session → refresh');
    const created = await onboardingService.createOrganization({ organization_name: 'Gizli Oto', phone: '05321234567', city: 'İzmir' });
    const slug = created.organization.slug;
    await session.setTokens(await authService.switchOrganizationContext(slug), slug);
    const scoped = await authService.getMe();
    ok(scoped.organizations?.find((o) => o.slug === slug)?.role === 'owner' && (scoped.permissions ?? []).length > 0, 'owner of the new business with tenant permissions');
    const refreshed = await authService.refresh(session.get()!.refreshToken);
    await session.setTokens(refreshed, slug);
    ok(Boolean(refreshed.access_token) && (await authService.getMe()).user.uuid === me.user.uuid, 'refresh keeps the organization session');
  }

  console.log('same Apple ID again → straight into the business');
  {
    const { app, flow, signOut } = createApp();
    await signOut();
    const message = await flow.run(() => api.nativeOAuth('apple', appleToken('apple-relay-new')), 'apple');
    ok(message === null && flow.getState().linkChoice === null, 'no link question the second time');
    ok(app.status === 'ready' && app.switches.length === 1, `one switch, into the business (${app.status})`);
  }

  console.log('relay account that lost its Apple identity');
  {
    const { app, flow, signOut } = createApp();
    await signOut();
    mockExt()._oauthIdentities = (mockExt()._oauthIdentities ?? []).filter((i) => i.sub !== 'apple-relay-new');
    const message = await flow.run(() => api.nativeOAuth('apple', appleToken('apple-relay-new')), 'apple');
    ok(message === null && app.status === 'ready', `relay address signs into its account again (${message ?? app.status})`);
    ok((mockExt()._oauthIdentities ?? []).some((i) => i.sub === 'apple-relay-new'), 'identity re-linked');
  }

  console.log('registration closed');
  {
    const { app, flow, sheet, signOut } = createApp();
    await signOut();
    const choice = await expectChoice(flow, () => api.nativeOAuth('apple', appleToken('apple-relay-closed')));
    ok(!choice.registerAllowed, 'register_allowed=false hides "create a new account"');
    const message = await flow.run(() => api.createFromLink(choice.linkTicket), 'apple');
    ok(message === tr('mobile.auth.error.registration_closed'), `link/create answers "registration closed" (${message})`);
    ok(flow.getState().linkChoice !== null && sheet.onScreen && app.status === 'signedOut', 'sheet stays with the message; still signed out');
    flow.closeLinkChoice();
    await sleep(SHEET_ANIMATION_MS * 2);
    ok(!sheet.onScreen && flow.getState().linkChoice === null, 'closing the sheet clears the choice');
  }

  console.log('tokens issued but the account cannot be opened (loop guard)');
  {
    const { app, flow, sheet, signOut } = createApp();
    await signOut();
    forgetRelayAccount('apple-relay-new');
    const choice = await expectChoice(flow, () => api.nativeOAuth('apple', appleToken('apple-relay-new')));
    app.failProfileLoads = 5;
    const messages: (string | null)[] = [];
    for (let i = 0; i < 3; i++) messages.push(await flow.run(() => api.createFromLink(choice.linkTicket), 'apple'));
    ok(messages[0] === tr('mobile.auth.error.session_failed'), `first failure explains the account could not be opened (${messages[0]})`);
    ok(messages[2] === tr('mobile.auth.error.repeated'), `third identical failure answers "keeps failing" (${messages[2]})`);
    ok(app.resets.length === 4 && app.resets.slice(1).every((r) => r === 'post_login_failed') && app.switches.length === 0, 'half-open session cleared each time, the navigator never switched');
    ok(session.get() === null && app.status === 'signedOut', 'signed out, no tokens left');
    ok(flow.getState().linkChoice !== null && sheet.onScreen, 'sheet stays (the user can retry or close)');
    app.failProfileLoads = 0;
    const retry = await flow.run(() => api.createFromLink(choice.linkTicket), 'apple');
    ok(retry === null && app.status === 'selectOrg' && app.switches.every((s) => !s.sheetOnScreen), `next try succeeds (${retry ?? app.status})`);
  }

  console.log('opening the account fails after the sheet closed → notice on the login screen');
  {
    const { app, flow, signOut } = createApp();
    await signOut();
    forgetRelayAccount('apple-relay-new');
    const choice = await expectChoice(flow, () => api.nativeOAuth('apple', appleToken('apple-relay-new')));
    app.failRoute = true;
    const message = await flow.run(() => api.createFromLink(choice.linkTicket), 'apple');
    ok(message === tr('mobile.auth.error.session_failed') && flow.getState().notice === message, `message kept as the flow notice (${flow.getState().notice})`);
    ok(app.status === 'signedOut' && app.resets.at(-1) === 'post_login_failed', 'signed out cleanly');
    app.failRoute = false;
    await flow.run(() => api.createFromLink(choice.linkTicket), 'apple');
    ok(flow.getState().notice === null && app.status === 'selectOrg', 'the next attempt clears the notice');
  }

  console.log('Google and "link existing account" still route the same way');
  {
    const { app, flow, signOut } = createApp();
    await signOut();
    const google = await flow.run(() => api.nativeOAuth('google', { id_token: demoIdToken(identity('google-unlinked')) }), 'google');
    ok(google === null && flow.getState().notLinked === 'google' && app.status === 'signedOut', 'Google with an existing e-mail → not-linked notice');

    const choice = await expectChoice(flow, () => api.nativeOAuth('apple', appleToken('apple-relay-closed')));
    ok(flow.getState().notLinked === null, 'a new attempt hides the not-linked notice');
    await api.requestLinkCode(choice.linkTicket, 'personel@otopoly.com');
    const linked = await flow.run(() => api.verifyLink(choice.linkTicket, 'personel@otopoly.com', DEMO_EMAIL_CODE), 'apple');
    ok(linked === null && app.status !== 'signedOut', `linked to the existing account and routed (${linked ?? app.status})`);
    ok(app.switches.length === 1 && !app.switches[0].sheetOnScreen && flow.getState().linkChoice === null, 'sheet closed before routing after linking too');
    ok((await authService.getMe()).user.email === 'personel@otopoly.com', 'signed into the existing account');
  }

  console.log('guards');
  {
    let now = 0;
    const guard = createRepeatGuard({ limit: 3, windowMs: 1000, now: () => now });
    ok(!guard.fail('a') && !guard.fail('a') && guard.fail('a'), 'third identical failure trips');
    ok(!guard.fail('b'), 'a different failure starts over');
    now = 5000;
    guard.fail('c');
    guard.fail('c');
    now = 7000;
    ok(!guard.fail('c'), 'outside the window it starts over');
    markSignedIn(10_000);
    ok(noteSessionLost(20_000) && getSignInNotice() === 'session_lost', 'session lost 10 s after sign-in → login notice');
    markSignedIn(30_000);
    ok(getSignInNotice() === null, 'next sign-in clears the notice');
    ok(!noteSessionLost(30_000 + 5 * 60_000) && getSignInNotice() === null, 'a session ending much later is a normal sign-out');
    ok(takeCreateBusinessForward() === true && takeCreateBusinessForward() === false, 'wizard forward once…');
    resetCreateBusinessForward();
    ok(takeCreateBusinessForward() === true, '…and once again after a new sign-in');
  }

  console.log(failures ? `${failures} FAILED` : 'apple relay smoke: all passed');
  process.exit(failures ? 1 : 0);
})();
