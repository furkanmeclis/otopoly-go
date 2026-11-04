/**
 * Sign-in error handling shared by the password, e-mail code, Apple / Google and account-linking
 * flows. Codes follow backend `feat/auth-otp-native-oauth` (docs/backend/WAVE1_CONTRACTS.md).
 */
import { detailMap, isApiError, type ApiError } from '@/api/errors';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const PROVIDER_NAME: Record<OAuthProvider, string> = { apple: 'Apple', google: 'Google' };

/** `403 MFA_REQUIRED` (or the legacy `TOTP_REQUIRED`): retry the same call with `totp_code`. */
export const isMfaRequired = (error: unknown): error is ApiError =>
  isApiError(error) && (error.code === 'MFA_REQUIRED' || error.code === 'TOTP_REQUIRED');

/** `409 OAUTH_LINK_CHOICE_REQUIRED` payload (Apple private relay, no account yet). */
export type LinkChoice = {
  linkTicket: string;
  provider: OAuthProvider;
  /** Seconds the ticket stays valid (900). */
  expiresIn: number;
  /** `false` → registration is closed, hide "No, create a new account". */
  registerAllowed: boolean;
};

export function linkChoiceFrom(error: unknown): LinkChoice | null {
  if (!isApiError(error) || error.code !== 'OAUTH_LINK_CHOICE_REQUIRED') return null;
  const d = detailMap(error);
  if (!d.link_ticket) return null;
  const expiresIn = Number(d.expires_in);
  return {
    linkTicket: d.link_ticket,
    provider: d.provider === 'google' ? 'google' : 'apple',
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900,
    registerAllowed: d.register_allowed !== 'false',
  };
}

/** Message for any sign-in error. `provider` names Apple / Google in OAuth-specific messages. */
export function authErrorMessage(tr: Translate, error: unknown, provider?: OAuthProvider): string {
  const code = isApiError(error) ? error.code : 'UNKNOWN';
  const name = PROVIDER_NAME[provider ?? 'apple'];
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return tr('auth.login.error');
    case 'INVALID_EMAIL_CODE':
      return tr('mobile.auth.error.invalid_email_code');
    case 'INVALID_MFA_CODE':
      return tr('auth.totp.login_invalid');
    case 'ACCOUNT_DEACTIVATED':
      return tr('mobile.auth.error.account_deactivated');
    case 'FORBIDDEN':
      // Native sign-up / link/create: registration closed. Elsewhere: disabled by an admin.
      return provider ? tr('mobile.auth.error.registration_closed') : tr('mobile.auth.error.account_disabled');
    case 'NO_TENANT_MEMBERSHIP':
      return tr('auth.login.no_tenant_membership');
    case 'RATE_LIMITED': {
      const seconds = isApiError(error) ? error.retryAfter : undefined;
      if (!seconds) return tr('auth.login.rate_limited');
      return seconds > 90
        ? tr('mobile.auth.error.rate_limited_minutes', { minutes: Math.ceil(seconds / 60) })
        : tr('mobile.auth.error.rate_limited_seconds', { seconds });
    }
    case 'INVALID_ID_TOKEN':
      return tr('mobile.auth.error.invalid_id_token', { provider: name });
    case 'OAUTH_PROVIDER_DISABLED':
      return tr('mobile.auth.error.provider_disabled', { provider: name });
    case 'OAUTH_ACCOUNT_NOT_LINKED':
      return tr('mobile.auth.not_linked.body', { provider: name });
    case 'INVALID_LINK_TICKET':
      return tr('mobile.auth.error.invalid_link_ticket', { provider: name });
    case 'CONFLICT':
      return tr('mobile.auth.error.link_conflict', { provider: name });
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return tr('mobile.error.network');
    default:
      return tr('common.error_generic');
  }
}

/**
 * Copy for a failed step of the shared sign-in flow: `attempt` — the sign-in call itself; `session` —
 * tokens were issued but the account could not be opened (profile / organization); `repeated` — the
 * same failure keeps coming back (see `lib/sign-in-flow.ts`).
 */
export function signInFailureMessage(tr: Translate, error: unknown, provider: OAuthProvider | undefined, kind: 'attempt' | 'session' | 'repeated'): string {
  if (kind === 'repeated') return tr('mobile.auth.error.repeated');
  if (kind === 'session') return isApiError(error) && error.isNetwork ? tr('mobile.error.network') : tr('mobile.auth.error.session_failed');
  return authErrorMessage(tr, error, provider);
}
