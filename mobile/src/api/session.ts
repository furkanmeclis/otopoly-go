import { createLogger } from '@/lib/logger';
import { secure, StorageKeys } from '@/lib/storage';

const log = createLogger('session');

/** Token pair as returned by `/v1/auth/login`, `/refresh`, `/organization-context` (schema `Tokens`). */
export type Tokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_at: string;
};

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  accessExpiresAt: number;
  refreshExpiresAt: string;
  /** Active organization slug the tokens are scoped to (JWT `oid`), if any. */
  organizationSlug: string | null;
};

let current: StoredSession | null = null;
const listeners = new Set<(s: StoredSession | null) => void>();

function emit() {
  for (const l of listeners) l(current);
}

export const session = {
  get: () => current,

  async load() {
    const raw = await secure.get(StorageKeys.session);
    if (!raw) return null;
    try {
      current = JSON.parse(raw) as StoredSession;
      log.info('Session restored', { organizationSlug: current.organizationSlug });
    } catch (error) {
      log.warn('Stored session unreadable, clearing', error);
      current = null;
      await secure.remove(StorageKeys.session);
    }
    emit();
    return current;
  },

  async setTokens(tokens: Tokens, organizationSlug: string | null) {
    current = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
      refreshExpiresAt: tokens.refresh_expires_at,
      organizationSlug,
    };
    await secure.set(StorageKeys.session, JSON.stringify(current));
    log.info('Session tokens stored', { organizationSlug, expiresIn: tokens.expires_in });
    emit();
  },

  async clear(reason: string) {
    if (!current) return;
    log.info('Session cleared', { reason });
    current = null;
    await secure.remove(StorageKeys.session);
    emit();
  },

  subscribe(listener: (s: StoredSession | null) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
