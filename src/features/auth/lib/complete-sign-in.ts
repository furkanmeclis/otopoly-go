/**
 * The steps every sign-in ends with, once the API has handed out a token pair (password, e-mail code,
 * Apple / Google, relay linking). Plain functions without React, so the smoke tests run the same order
 * of steps the auth provider runs.
 */
import { isApiError } from '@/api/errors';
import type { Tokens } from '@/api/session';
import type { Me, OrganizationMembership } from '@/features/account/services/auth.service';
import { createLogger } from '@/lib/logger';

import { orgBlock } from './access';

const log = createLogger('auth.complete');

export type SignInOptions = {
  /**
   * Runs with the new session's tokens before the profile is loaded and the user is routed (e.g. the
   * sign-up screen saves the name a code sign-up could not send). Failures are logged, never block sign-in.
   */
  prepare?: () => Promise<void>;
};

/** Where a freshly loaded profile goes: straight into an organization, or to the picker. */
export type Entry = { kind: 'enter'; slug: string } | { kind: 'select' };

/**
 * Straight into the preferred organization when it is usable, or into the only one; otherwise the
 * picker (none yet → it offers "create your business"; several, or only blocked ones → the user picks).
 */
export function entryFor(profile: Pick<Me, 'organizations'>, preferredSlug: string | null): Entry {
  const orgs: OrganizationMembership[] = profile.organizations ?? [];
  const usable = orgs.filter((o) => !orgBlock(o));
  const preferred = preferredSlug ? usable.find((o) => o.slug === preferredSlug) : null;
  const target = preferred ?? (orgs.length === 1 && usable.length === 1 ? usable[0] : null);
  return target ? { kind: 'enter', slug: target.slug } : { kind: 'select' };
}

export type CompleteSignInDeps = {
  storeTokens: (tokens: Tokens) => Promise<void>;
  loadProfile: () => Promise<Me>;
  syncLocale: (profile: Me) => void;
  /** Applies `entryFor` (enters the organization or opens the picker): this switches the navigator. */
  route: (profile: Me) => Promise<void>;
  /** Clears the half-finished session (signed out again). */
  reset: (reason: string) => Promise<void>;
  /** After routing: intro seen, push registration and the like. Must not throw. */
  signedIn: (profile: Me) => void;
};

export async function completeSignInSteps(deps: CompleteSignInDeps, tokens: Tokens, options?: SignInOptions) {
  await deps.storeTokens(tokens);
  if (options?.prepare) {
    try {
      await options.prepare();
    } catch (error) {
      log.warn('Sign-in preparation failed', isApiError(error) ? error.code : error);
    }
  }
  try {
    const profile = await deps.loadProfile();
    deps.syncLocale(profile);
    await deps.route(profile);
    deps.signedIn(profile);
  } catch (error) {
    await deps.reset('post_login_failed');
    throw error;
  }
}
