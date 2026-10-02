/**
 * Linked-account rules (pure, no React Native imports, so the smoke tests can use them).
 *
 * Unlinking: an account without a password must keep at least one other sign-in provider, so its
 * last linked provider can't be removed. The e-mail code still works, but for an Apple private-relay
 * address that would be the only way in, so the app keeps the rule strict. When the server doesn't
 * report `has_password` the button stays enabled and the server decides (`409 LAST_SIGN_IN_METHOD`).
 */
import type { IdentityList } from '@/features/account/services/identities.service';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';

export const LINKABLE_PROVIDERS: readonly OAuthProvider[] = ['apple', 'google'];

export type UnlinkBlock = 'last_method' | null;

export function unlinkBlock(list: IdentityList | undefined, provider: string): UnlinkBlock {
  if (!list || list.has_password !== false) return null;
  const others = list.items.filter((i) => i.provider !== provider).length;
  return others === 0 ? 'last_method' : null;
}

/** Translation key for a failed link / unlink (static keys, so check-i18n can verify them). */
export function identityErrorKey(code: string | undefined) {
  switch (code) {
    case 'IDENTITY_ALREADY_LINKED':
      return 'mobile.account.linked.error_in_use';
    case 'CONFLICT':
      return 'mobile.account.linked.error_conflict';
    case 'LAST_SIGN_IN_METHOD':
      return 'mobile.account.linked.last_method';
    case 'INVALID_ID_TOKEN':
      return 'mobile.account.linked.error_token';
    case 'OAUTH_PROVIDER_DISABLED':
      return 'mobile.account.linked.error_disabled';
    case 'NOT_FOUND':
      return 'mobile.account.linked.error_not_found';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return 'mobile.error.network';
    default:
      return 'common.error_generic';
  }
}
