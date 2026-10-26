/**
 * Sign-in flow state machine shared by the login, sign-up and account-linking screens (no React, so the
 * smoke tests drive exactly what the screens run; `use-sign-in-flow.ts` is the hook around it).
 *
 * Runs any sign-in call and handles the shared outcomes in one place:
 *   tokens                      → `completeSignIn` (org routing)
 *   MFA_REQUIRED                → `mfa` is set; `submitTotp` repeats the same call with the code
 *   OAUTH_LINK_CHOICE_REQUIRED  → `linkChoice` is set ("Hesabım var mı?")
 *   OAUTH_ACCOUNT_NOT_LINKED    → `notLinked` is set
 * Anything else comes back as a message for the caller to show where the user is looking.
 *
 * Guards (2026-10 TestFlight report: Apple "Hide my email" → "create a new account" never finished):
 *  - The "Hesabım var mı?" sheet is a native modal on the login screen. On success it is closed and
 *    its dismissal awaited BEFORE the session routes: switching the navigator under a presented modal
 *    left it orphaned on iOS (stuck on its spinner while the organization picker opened underneath).
 *  - One call at a time: a second tap while a sign-in runs is ignored (no parallel sessions).
 *  - The same step failing the same way three times in a row answers "keeps failing" (and reports it)
 *    instead of the same error forever.
 */
import { isApiError } from '@/api/errors';
import type { Tokens } from '@/api/session';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';
import { createLogger } from '@/lib/logger';

import { isMfaRequired, linkChoiceFrom, type LinkChoice, type signInFailureMessage } from './auth-errors';
import type { SignInOptions } from './complete-sign-in';
import { createRepeatGuard } from './sign-in-guard';

const log = createLogger('auth.flow');

/** One sign-in call; called again with `totp` after `MFA_REQUIRED`. */
export type SignInAttempt = (totp?: string) => Promise<Tokens>;

export type PendingMfa = { attempt: SignInAttempt; provider?: OAuthProvider; options?: SignInOptions };

export type SignInFlowState = {
  busy: boolean;
  mfa: PendingMfa | null;
  linkChoice: LinkChoice | null;
  notLinked: OAuthProvider | null;
  /**
   * A failure the screen itself has to show: the sheet that started the call was already closed for
   * routing when the session could not be opened. Cleared by the next attempt.
   */
  notice: string | null;
};

/**
 * Which message to show: `attempt` — the sign-in call failed; `session` — tokens were issued but the
 * account could not be opened (profile / organization); `repeated` — the same failure again and again.
 */
export type FailureKind = Parameters<typeof signInFailureMessage>[3];

export type SignInFlowDeps = {
  completeSignIn: (tokens: Tokens, options?: SignInOptions) => Promise<void>;
  /** User-facing message for a failed step. */
  message: (error: unknown, provider: OAuthProvider | undefined, kind: FailureKind) => string;
  /** "After the usual sign-in, open Profile → Linked accounts for this provider." */
  setLinkIntent: (provider: OAuthProvider | null) => void;
};

/** Upper bound for the sheet's close animation when the platform does not report it (Android). */
export const SHEET_DISMISS_TIMEOUT_MS = 600;

/** Answers about the request itself (typos, throttling): repeating them is not a loop. */
const USER_INPUT_CODES = new Set(['INVALID_CREDENTIALS', 'INVALID_EMAIL_CODE', 'INVALID_MFA_CODE', 'VALIDATION_ERROR', 'RATE_LIMITED']);

const INITIAL: SignInFlowState = { busy: false, mfa: null, linkChoice: null, notLinked: null, notice: null };

export type SignInFlowOptions = { sheetDismissTimeoutMs?: number; now?: () => number };

/** `setDeps` swaps in the latest `completeSignIn` / translator (the hook calls it after each render). */
export function createSignInFlow(initialDeps: SignInFlowDeps, { sheetDismissTimeoutMs = SHEET_DISMISS_TIMEOUT_MS, now }: SignInFlowOptions = {}) {
  let current = initialDeps;
  let state = INITIAL;
  let running = false;
  let sheetClosing: (() => void) | null = null;
  const repeat = createRepeatGuard({ now });
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SignInFlowState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  /** Closes the link sheet and resolves once it is off screen (reported, or after the timeout). */
  const closeSheet = () =>
    new Promise<void>((resolve) => {
      if (!state.linkChoice) {
        resolve();
        return;
      }
      const timer = setTimeout(() => done(), sheetDismissTimeoutMs);
      const done = () => {
        clearTimeout(timer);
        if (sheetClosing === done) sheetClosing = null;
        resolve();
      };
      sheetClosing = done;
      set({ linkChoice: null });
    });

  const execute = async (attempt: SignInAttempt, provider: OAuthProvider | undefined, totp?: string, options?: SignInOptions): Promise<string | null> => {
    if (running) {
      log.info('Sign-in already running; second request ignored', { provider });
      return null;
    }
    running = true;
    const d = current;
    let stage: 'attempt' | 'session' = 'attempt';
    const fromSheet = Boolean(state.linkChoice);
    set({ busy: true, notice: null });
    try {
      const tokens = await attempt(totp);
      stage = 'session';
      await d.completeSignIn(tokens, {
        ...options,
        beforeRoute: async () => {
          set({ mfa: null, notLinked: null });
          await closeSheet();
          await options?.beforeRoute?.();
        },
      });
      repeat.reset();
      return null;
    } catch (error) {
      const code = isApiError(error) ? error.code : 'UNKNOWN';
      log.warn('Sign-in step failed', { code, provider, stage, mfa: Boolean(totp) });
      if (stage === 'attempt') {
        if (isMfaRequired(error)) {
          set({ linkChoice: null, mfa: { attempt, provider, options } });
          return null;
        }
        const choice = linkChoiceFrom(error);
        if (choice) {
          set({ mfa: null, linkChoice: choice });
          return null;
        }
        if (code === 'OAUTH_ACCOUNT_NOT_LINKED') {
          set({ mfa: null, linkChoice: null, notLinked: provider ?? 'apple' });
          d.setLinkIntent(provider ?? 'apple');
          return null;
        }
      }
      // A wrong authenticator code keeps the TOTP step open; anything else ends it.
      if (totp && code !== 'INVALID_MFA_CODE') set({ mfa: null });
      const repeated = !USER_INPUT_CODES.has(code) && repeat.fail(`${stage}:${code}`);
      if (repeated) log.error('Sign-in keeps failing the same way', { code, stage, provider });
      const message = d.message(error, provider, repeated ? 'repeated' : stage);
      // The sheet that started the call is gone (closed for routing, or by the user): the screen shows it.
      if (fromSheet && !state.linkChoice) set({ notice: message });
      return message;
    } finally {
      running = false;
      set({ busy: false });
    }
  };

  return {
    getState: () => state,
    setDeps(next: SignInFlowDeps) {
      current = next;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run(attempt: SignInAttempt, provider?: OAuthProvider, options?: SignInOptions) {
      if (!running) set({ notLinked: null });
      return execute(attempt, provider, undefined, options);
    },
    submitTotp(totp: string) {
      const mfa = state.mfa;
      return mfa ? execute(mfa.attempt, mfa.provider, totp, mfa.options) : Promise.resolve(null);
    },
    cancelMfa: () => set({ mfa: null }),
    /** The user closed the sheet (X, swipe down). */
    closeLinkChoice: () => set({ linkChoice: null }),
    /** The sheet reports it is fully off screen (iOS `Modal.onDismiss`). */
    sheetDismissed: () => sheetClosing?.(),
    clearNotice: () => set({ notice: null }),
    /** Dismissing the notice also drops the "open linked accounts after sign-in" hint. */
    clearNotLinked: () => {
      set({ notLinked: null });
      current.setLinkIntent(null);
    },
    /** Hides the notice but keeps the hint (the user goes on to sign in the usual way). */
    hideNotLinked: () => set({ notLinked: null }),
  };
}

export type SignInFlowController = ReturnType<typeof createSignInFlow>;
