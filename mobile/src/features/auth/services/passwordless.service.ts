import { request } from '@/api/client';
import type { components } from '@/api/generated/api';
import type { Tokens } from '@/api/session';

/**
 * Passwordless sign-in and account deletion (Go API, backend `feat/auth-otp-native-oauth`).
 * Every sign-in call returns the same token pair as `/v1/auth/login` and supports the
 * `MFA_REQUIRED` → `totp_code` round-trip. Screens handle errors themselves (`silent`).
 */
export type OAuthProvider = 'apple' | 'google';

export type AccountDeletionScheduled = components['schemas']['AccountDeletionScheduled'];

/** Body of `POST /v1/auth/oauth/{provider}/native`. */
export type NativeOAuthInput = {
  id_token: string;
  /** Raw nonce; the SDK got its SHA-256 hex, the backend accepts either. */
  nonce?: string;
  /** Apple: only on the first sign-in. */
  given_name?: string;
  family_name?: string;
  /** Apple: lets the server store (and on deletion revoke) a refresh token. */
  authorization_code?: string;
};

type Accepted = { status: string };

const anon = { anonymous: true, silent: true } as const;
const withTotp = (totp?: string) => (totp ? { totp_code: totp } : {});

export const passwordlessService = {
  requestEmailCode(email: string) {
    return request<Accepted>('POST', '/v1/auth/email-code/request', { ...anon, body: { email } });
  },
  verifyEmailCode(email: string, code: string, totp?: string) {
    return request<Tokens>('POST', '/v1/auth/email-code/verify', { ...anon, body: { email, code, ...withTotp(totp) } });
  },
  nativeOAuth(provider: OAuthProvider, input: NativeOAuthInput, totp?: string) {
    return request<Tokens>('POST', `/v1/auth/oauth/${provider}/native`, { ...anon, body: { ...input, ...withTotp(totp) } });
  },
  requestLinkCode(linkTicket: string, email: string) {
    return request<Accepted>('POST', '/v1/auth/oauth/link/request', { ...anon, body: { link_ticket: linkTicket, email } });
  },
  verifyLink(linkTicket: string, email: string, code: string, totp?: string) {
    return request<Tokens>('POST', '/v1/auth/oauth/link/verify', { ...anon, body: { link_ticket: linkTicket, email, code, ...withTotp(totp) } });
  },
  createFromLink(linkTicket: string, totp?: string) {
    return request<Tokens>('POST', '/v1/auth/oauth/link/create', { ...anon, body: { link_ticket: linkTicket, ...withTotp(totp) } });
  },
  /** Bearer: e-mails a 6-digit confirmation code (5 per 15 minutes). */
  requestDeactivationCode() {
    return request<Accepted>('POST', '/v1/auth/account/deactivate/request', { silent: true });
  },
  /**
   * Bearer: deletes the account with a 30-day recovery window. It is disabled at once (every later
   * sign-in → ACCOUNT_DEACTIVATED), recoverable on the web page until `deletion_scheduled_on`
   * (Europe/Istanbul day), then anonymized. Businesses the user owns are kept.
   */
  deactivate(code: string) {
    return request<AccountDeletionScheduled>('POST', '/v1/auth/account/deactivate', { silent: true, body: { code } });
  },
};
