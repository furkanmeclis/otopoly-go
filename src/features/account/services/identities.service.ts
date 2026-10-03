import { request } from '@/api/client';
import type { NativeOAuthInput, OAuthProvider } from '@/features/auth/services/passwordless.service';

/** One linked sign-in provider (backend `LinkedIdentity`). */
export type LinkedIdentity = {
  provider: string;
  github_login?: string | null;
  linked_at: string;
};

/**
 * `GET /v1/auth/identities`. `has_password` is a mobile addition the backend doesn't send yet
 * (docs/port-reports/account.md); when it's missing the app lets the server decide on unlink.
 */
export type IdentityList = {
  items: LinkedIdentity[];
  total: number;
  has_password?: boolean;
};

/** Same paths as the web `authService.listIdentities` / `unlinkIdentity`. */
export const identitiesService = {
  list() {
    return request<IdentityList>('GET', '/v1/auth/identities', { silent: true });
  },
  /** Links Apple / Google to the signed-in account with a native id_token (proposed backend route). */
  linkNative(provider: OAuthProvider, input: NativeOAuthInput) {
    return request<LinkedIdentity>('POST', `/v1/auth/identities/${provider}/native`, { body: input, silent: true });
  },
  unlink(provider: OAuthProvider) {
    return request<{ status: string }>('DELETE', `/v1/auth/identities/${provider}`, { silent: true });
  },
};
