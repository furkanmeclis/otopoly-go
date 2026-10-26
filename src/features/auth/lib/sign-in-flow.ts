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
 */
import { isApiError } from '@/api/errors';
import type { Tokens } from '@/api/session';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';
import { createLogger } from '@/lib/logger';

import { isMfaRequired, linkChoiceFrom, type LinkChoice } from './auth-errors';
import type { SignInOptions } from './complete-sign-in';

const log = createLogger('auth.flow');

/** One sign-in call; called again with `totp` after `MFA_REQUIRED`. */
export type SignInAttempt = (totp?: string) => Promise<Tokens>;

export type PendingMfa = { attempt: SignInAttempt; provider?: OAuthProvider; options?: SignInOptions };

export type SignInFlowState = {
  busy: boolean;
  mfa: PendingMfa | null;
  linkChoice: LinkChoice | null;
  notLinked: OAuthProvider | null;
};

export type SignInFlowDeps = {
  completeSignIn: (tokens: Tokens, options?: SignInOptions) => Promise<void>;
  /** User-facing message for a failed step. */
  message: (error: unknown, provider?: OAuthProvider) => string;
  /** "After the usual sign-in, open Profile → Linked accounts for this provider." */
  setLinkIntent: (provider: OAuthProvider | null) => void;
};

const INITIAL: SignInFlowState = { busy: false, mfa: null, linkChoice: null, notLinked: null };

/** `setDeps` swaps in the latest `completeSignIn` / translator (the hook calls it after each render). */
export function createSignInFlow(initialDeps: SignInFlowDeps) {
  let current = initialDeps;
  const deps = () => current;
  let state = INITIAL;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SignInFlowState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const execute = async (attempt: SignInAttempt, provider: OAuthProvider | undefined, totp?: string, options?: SignInOptions): Promise<string | null> => {
    const d = deps();
    set({ busy: true });
    try {
      const tokens = await attempt(totp);
      await d.completeSignIn(tokens, options);
      return null;
    } catch (error) {
      const code = isApiError(error) ? error.code : 'UNKNOWN';
      log.warn('Sign-in step failed', { code, provider, mfa: Boolean(totp) });
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
        set({ mfa: null, notLinked: provider ?? 'apple' });
        d.setLinkIntent(provider ?? 'apple');
        return null;
      }
      // A wrong authenticator code keeps the TOTP step open; anything else ends it.
      if (totp && code !== 'INVALID_MFA_CODE') set({ mfa: null });
      return d.message(error, provider);
    } finally {
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
      set({ notLinked: null });
      return execute(attempt, provider, undefined, options);
    },
    submitTotp(totp: string) {
      const mfa = state.mfa;
      return mfa ? execute(mfa.attempt, mfa.provider, totp, mfa.options) : Promise.resolve(null);
    },
    cancelMfa: () => set({ mfa: null }),
    closeLinkChoice: () => set({ linkChoice: null }),
    /** Dismissing the notice also drops the "open linked accounts after sign-in" hint. */
    clearNotLinked: () => {
      set({ notLinked: null });
      deps().setLinkIntent(null);
    },
    /** Hides the notice but keeps the hint (the user goes on to sign in the usual way). */
    hideNotLinked: () => set({ notLinked: null }),
  };
}

export type SignInFlowController = ReturnType<typeof createSignInFlow>;
