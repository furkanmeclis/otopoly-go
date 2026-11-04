/**
 * Loop guards for sign-in (no React, smoke-tested):
 *  - `createRepeatGuard`: the same step failing the same way again and again (e.g. the account opens
 *    with an error every time) is reported once and answered with a "keeps failing" message instead of
 *    the same error forever.
 *  - session loss right after a sign-in (the server rejects the brand-new session, refresh fails, the
 *    app signs out): remembered for the login screen, so the user sees why instead of a silent bounce.
 */
import { createLogger } from '@/lib/logger';

const log = createLogger('auth.guard');

export type RepeatGuardOptions = { limit?: number; windowMs?: number; now?: () => number };

/** `fail(signature)` → `true` from the `limit`-th identical failure in a row within `windowMs`. */
export function createRepeatGuard({ limit = 3, windowMs = 2 * 60_000, now = Date.now }: RepeatGuardOptions = {}) {
  let last: { signature: string; count: number; since: number } | null = null;
  return {
    fail(signature: string) {
      const at = now();
      if (last && last.signature === signature && at - last.since <= windowMs) last.count++;
      else last = { signature, count: 1, since: at };
      return last.count >= limit;
    },
    reset() {
      last = null;
    },
  };
}

// ─── Session lost right after sign-in ──────────────────────────────────────

/** A session that ends this soon after sign-in was rejected by the server, not ended by the user. */
export const EARLY_SESSION_LOSS_MS = 60_000;

export type SignInNotice = 'session_lost' | null;

let signedInAt = 0;
let notice: SignInNotice = null;
const listeners = new Set<() => void>();
const setNotice = (next: SignInNotice) => {
  if (notice === next) return;
  notice = next;
  listeners.forEach((l) => l());
};

export function markSignedIn(at = Date.now()) {
  signedInAt = at;
  setNotice(null);
}

/** The app was signed out by an auth failure; `true` (and a login notice) when it hit a fresh session. */
export function noteSessionLost(at = Date.now()) {
  const early = signedInAt > 0 && at - signedInAt <= EARLY_SESSION_LOSS_MS;
  signedInAt = 0;
  if (early) {
    log.error('Session rejected right after sign-in');
    setNotice('session_lost');
  }
  return early;
}

export const getSignInNotice = () => notice;
export const clearSignInNotice = () => setNotice(null);
export function subscribeSignInNotice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
