/**
 * Demo-only sign-in fixtures for the in-app mock: fixed codes, Apple / Google demo identities and
 * the list of e-mail codes the mock "sent". Kept free of mock DB imports so the login and
 * diagnostics screens can read it without loading the mock.
 */

/**
 * Fixed e-mail code for the demo accounts, like the backend's `AUTH_REVIEW_ACCOUNTS=email:code`
 * (no e-mail is sent for these; the code also confirms account deletion).
 */
export const DEMO_EMAIL_CODE = '246810';
export const DEMO_REVIEW_EMAILS = ['demo@otopoly.com', 'personel@otopoly.com', 'ali@parlakoto.com'] as const;
/** What the demo authenticator app always shows for TOTP users (ali@parlakoto.com). */
export const DEMO_TOTP_CODE = '123456';

export type DemoIdentity = {
  /** Mock id_token subject. */
  sub: string;
  provider: 'apple' | 'google';
  email: string;
  given_name?: string;
  family_name?: string;
  /** Account the identity is already linked to (seeded on first use). */
  linkedTo?: string;
  /** Mock registration policy for this identity (`register_allowed`). */
  registerAllowed?: boolean;
  /** `mobile` catalog key describing the scenario. */
  labelKey: string;
};

export const DEMO_IDENTITIES: readonly DemoIdentity[] = [
  { sub: 'apple-linked', provider: 'apple', email: 'demo@otopoly.com', linkedTo: 'demo@otopoly.com', labelKey: 'mobile.auth.demo.apple_linked' },
  { sub: 'apple-relay-new', provider: 'apple', email: 'k7x2p9qz4m@privaterelay.appleid.com', given_name: 'Deniz', family_name: 'Aksoy', labelKey: 'mobile.auth.demo.apple_relay' },
  { sub: 'apple-relay-closed', provider: 'apple', email: 'w3n8d5t1rb@privaterelay.appleid.com', registerAllowed: false, labelKey: 'mobile.auth.demo.apple_relay_closed' },
  { sub: 'google-unlinked', provider: 'google', email: 'personel@otopoly.com', labelKey: 'mobile.auth.demo.google_unlinked' },
] as const;

/** Mock id_token: `mock-idt.<provider>.<sub>[.<nonce>]` (the mock checks the nonce like the backend). */
export function demoIdToken(identity: Pick<DemoIdentity, 'provider' | 'sub'>, nonce?: string) {
  return ['mock-idt', identity.provider, identity.sub, ...(nonce ? [nonce] : [])].join('.');
}

export function parseDemoIdToken(token: string) {
  const [prefix, provider, sub, nonce] = token.split('.');
  if (prefix !== 'mock-idt' || !provider || !sub) return null;
  const identity = DEMO_IDENTITIES.find((i) => i.provider === provider && i.sub === sub);
  return identity ? { identity, nonce: nonce || undefined } : null;
}

// ─── Codes the mock "e-mailed" (shown on the diagnostics screen) ──────────

export type IssuedCode = { email: string; code: string; purpose: 'login' | 'link' | 'deactivate'; at: number };

let issued: IssuedCode[] = [];
const listeners = new Set<() => void>();

export function recordIssuedCode(entry: Omit<IssuedCode, 'at'>) {
  issued = [{ ...entry, at: Date.now() }, ...issued].slice(0, 8);
  listeners.forEach((l) => l());
}

export const getIssuedCodes = () => issued;

export function subscribeIssuedCodes(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
