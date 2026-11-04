/**
 * `409 OAUTH_ACCOUNT_NOT_LINKED` on the sign-in screen: the user is told to sign in the usual way
 * and link the provider from the profile. The provider is remembered here (memory only, this app
 * launch) and `LinkIntentHost` opens Profile → Linked accounts once they're inside an organization.
 */
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';

let pending: OAuthProvider | null = null;

export function setLinkIntent(provider: OAuthProvider | null) {
  pending = provider;
}

export function takeLinkIntent() {
  const value = pending;
  pending = null;
  return value;
}
