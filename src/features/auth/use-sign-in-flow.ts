import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

import { setLinkIntent } from '@/features/account/link-intent';
import { useAuth } from '@/features/auth/auth-provider';
import { authErrorMessage } from '@/features/auth/lib/auth-errors';
import { createSignInFlow, type SignInFlowDeps } from '@/features/auth/lib/sign-in-flow';
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
  const deps: SignInFlowDeps = { completeSignIn, message: (error, provider) => authErrorMessage(tr, error, provider), setLinkIntent };
  const [flow] = useState(() => createSignInFlow(deps));
  useLayoutEffect(() => flow.setDeps(deps));
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);

  return {
    ...state,
    run: flow.run,
    submitTotp: flow.submitTotp,
    cancelMfa: flow.cancelMfa,
    closeLinkChoice: flow.closeLinkChoice,
    clearNotLinked: flow.clearNotLinked,
    hideNotLinked: flow.hideNotLinked,
  };
}

export type SignInFlow = ReturnType<typeof useSignInFlow>;
