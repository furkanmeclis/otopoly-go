import { request } from '@/api/client';
import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type RegisterInput = Schemas['RegisterRequest'];
export type RegisterResult = Schemas['RegisterResponse'];

/**
 * Self-serve sign-up (Go API, same endpoints the web uses):
 *   POST /v1/auth/register   { email, password, name, surname } → 201 { user }   (no tokens)
 *     400 VALIDATION_ERROR (password policy, missing field) · 403 FORBIDDEN (password sign-up off) ·
 *     409 CONFLICT (e-mail already registered) · 429 RATE_LIMITED
 * The address is then proven with the e-mail code (`/v1/auth/email-code/*`), which also signs in and
 * marks the e-mail verified. Without a password the code alone creates the account.
 */
export const registerService = {
  register(body: RegisterInput) {
    return request<RegisterResult>('POST', '/v1/auth/register', { body, anonymous: true, silent: true });
  },
};

/** Backend `password.ValidatePassword`: 8+ characters with a lower-case letter, an upper-case letter and a digit. */
export const PASSWORD_RULES = [
  { key: 'length', test: (v: string) => v.length >= 8 },
  { key: 'lower', test: (v: string) => /[a-z]/.test(v) },
  { key: 'upper', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'digit', test: (v: string) => /[0-9]/.test(v) },
] as const;

export type PasswordRule = (typeof PASSWORD_RULES)[number]['key'];

export const passwordValid = (value: string) => PASSWORD_RULES.every((r) => r.test(value));

/**
 * A code sign-up creates the user with `name` = the e-mail's local part and an empty surname. Such a
 * profile (and no organization yet) means the account was created just now and may take the typed name;
 * anything else is an existing account that only signed in, and its profile is left alone.
 */
export function isFreshCodeAccount(profile: { user: { email: string; name: string; surname: string }; organizations?: unknown[] | null }) {
  const local = profile.user.email.split('@')[0] ?? '';
  return profile.user.name === local && !profile.user.surname && !(profile.organizations?.length ?? 0);
}
