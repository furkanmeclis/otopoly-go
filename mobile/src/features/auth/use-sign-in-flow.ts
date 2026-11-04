import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { setLinkIntent } from '@/features/account/link-intent';
import { useAuth } from '@/features/auth/auth-provider';
import { signInFailureMessage } from '@/features/auth/lib/auth-errors';
import { createSignInFlow, type SignInAttempt, type SignInFlowDeps } from '@/features/auth/lib/sign-in-flow';
import { clearSignInNotice, getSignInNotice, subscribeSignInNotice } from '@/features/auth/lib/sign-in-guard';
import type { SignInOptions } from '@/features/auth/lib/complete-sign-in';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';
import { useLocale } from '@/lib/i18n/provider';

export type { SignInAttempt } from '@/features/auth/lib/sign-in-flow';

/**
 * React binding of the shared sign-in flow (`lib/sign-in-flow.ts`): password, e-mail code, Apple /
 * Google and relay linking all run through it, so MFA, "Hesabım var mı?" and not-linked are handled
 * the same way on every screen.
 */
export function useSignInFlow() {
  const { t: tr } = useLocale();
  const { completeSignIn } = useAuth();
  const deps: SignInFlowDeps = { completeSignIn, message: (error, provider, kind) => signInFailureMessage(tr, error, provider, kind), setLinkIntent };
  const [flow] = useState(() => createSignInFlow(deps));
  useLayoutEffect(() => flow.setDeps(deps));
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  const signInNotice = useSyncExternalStore(subscribeSignInNotice, getSignInNotice, getSignInNotice);
  const run = useCallback(
    (attempt: SignInAttempt, provider?: OAuthProvider, options?: SignInOptions) => {
      clearSignInNotice();
      return flow.run(attempt, provider, options);
    },
    [flow],
  );

  return {
    ...state,
    /** The flow's own notice, else why the last session ended right after signing in. */
    notice: state.notice ?? (signInNotice === 'session_lost' ? tr('mobile.auth.error.session_lost') : null),
    run,
    submitTotp: flow.submitTotp,
    cancelMfa: flow.cancelMfa,
    closeLinkChoice: flow.closeLinkChoice,
    sheetDismissed: flow.sheetDismissed,
    clearNotice: flow.clearNotice,
    clearNotLinked: flow.clearNotLinked,
    hideNotLinked: flow.hideNotLinked,
  };
}

export type SignInFlow = ReturnType<typeof useSignInFlow>;
