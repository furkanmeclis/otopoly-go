import { useCallback, useState } from 'react';

import { isApiError } from '@/api/errors';
import { setLinkIntent } from '@/features/account/link-intent';
import type { Tokens } from '@/api/session';
import { useAuth } from '@/features/auth/auth-provider';
import { authErrorMessage, isMfaRequired, linkChoiceFrom, type LinkChoice } from '@/features/auth/lib/auth-errors';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth.flow');

/** One sign-in call; called again with `totp` after `MFA_REQUIRED`. */
export type SignInAttempt = (totp?: string) => Promise<Tokens>;

type PendingMfa = { attempt: SignInAttempt; provider?: OAuthProvider };

/**
 * Runs any sign-in call (password, e-mail code, Apple / Google, relay linking) and handles the
 * shared outcomes in one place:
 *   tokens                      → `completeSignIn` (org routing)
 *   MFA_REQUIRED                → `mfa` is set; `submitTotp` repeats the same call with the code
 *   OAUTH_LINK_CHOICE_REQUIRED  → `linkChoice` is set ("Hesabım var mı?")
 *   OAUTH_ACCOUNT_NOT_LINKED    → `notLinked` is set
 * Anything else comes back as a message for the caller to show where the user is looking.
 */
export function useSignInFlow() {
  const { t: tr } = useLocale();
  const { completeSignIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<PendingMfa | null>(null);
  const [linkChoice, setLinkChoice] = useState<LinkChoice | null>(null);
  const [notLinked, setNotLinked] = useState<OAuthProvider | null>(null);

  const execute = useCallback(
    async (attempt: SignInAttempt, provider: OAuthProvider | undefined, totp?: string): Promise<string | null> => {
      setBusy(true);
      try {
        const tokens = await attempt(totp);
        await completeSignIn(tokens);
        return null;
      } catch (error) {
        const code = isApiError(error) ? error.code : 'UNKNOWN';
        log.warn('Sign-in step failed', { code, provider, mfa: Boolean(totp) });
        if (isMfaRequired(error)) {
          setLinkChoice(null);
          setMfa({ attempt, provider });
          return null;
        }
        const choice = linkChoiceFrom(error);
        if (choice) {
          setMfa(null);
          setLinkChoice(choice);
          return null;
        }
        if (code === 'OAUTH_ACCOUNT_NOT_LINKED') {
          setMfa(null);
          setNotLinked(provider ?? 'apple');
          // After the usual sign-in, open Profile → Linked accounts for this provider.
          setLinkIntent(provider ?? 'apple');
          return null;
        }
        // A wrong authenticator code keeps the TOTP step open; anything else ends it.
        if (totp && code !== 'INVALID_MFA_CODE') setMfa(null);
        return authErrorMessage(tr, error, provider);
      } finally {
        setBusy(false);
      }
    },
    [completeSignIn, tr],
  );

  const run = useCallback(
    (attempt: SignInAttempt, provider?: OAuthProvider) => {
      setNotLinked(null);
      return execute(attempt, provider);
    },
    [execute],
  );

  const submitTotp = useCallback(
    (totp: string) => (mfa ? execute(mfa.attempt, mfa.provider, totp) : Promise.resolve(null)),
    [execute, mfa],
  );

  return {
    busy,
    run,
    mfa,
    submitTotp,
    cancelMfa: useCallback(() => setMfa(null), []),
    linkChoice,
    closeLinkChoice: useCallback(() => setLinkChoice(null), []),
    notLinked,
    /** Dismissing the notice also drops the "open linked accounts after sign-in" hint. */
    clearNotLinked: useCallback(() => {
      setNotLinked(null);
      setLinkIntent(null);
    }, []),
    /** Hides the notice but keeps the hint (the user goes on to sign in the usual way). */
    hideNotLinked: useCallback(() => setNotLinked(null), []),
  };
}

export type SignInFlow = ReturnType<typeof useSignInFlow>;
