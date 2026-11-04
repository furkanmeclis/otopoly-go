/**
 * AI assistant data-sharing consent (App Store Guideline 5.1.2(i)): before the first message the
 * user is told which provider receives data and what data, and must agree explicitly. Consent is
 * stored per user on the device (`ai.consent.<userUuid>`), tied to the provider it was given for
 * (a provider change asks again) and can be withdrawn from Preferences.
 *
 * No React Native imports, so the smoke tests can use it (AsyncStorage is stubbed there).
 */
import { useCallback, useEffect, useState } from 'react';

import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

const log = createLogger('ai.consent');

/** Bump when the disclosure text changes materially; older consents are asked again. */
export const AI_CONSENT_VERSION = 1;

export type AIConsent = { version: number; provider: string; accepted_at: string };

const key = (userUuid: string) => `${StorageKeys.aiConsent}.${userUuid}`;
const listeners = new Set<(userUuid: string) => void>();
const emit = (userUuid: string) => listeners.forEach((l) => l(userUuid));

export function loadConsent(userUuid: string) {
  return prefs.get<AIConsent | null>(key(userUuid), null);
}

export async function saveConsent(userUuid: string, provider: string) {
  const consent: AIConsent = { version: AI_CONSENT_VERSION, provider, accepted_at: new Date().toISOString() };
  await prefs.set(key(userUuid), consent);
  log.info('AI data sharing accepted', { provider, version: AI_CONSENT_VERSION });
  emit(userUuid);
  return consent;
}

export async function revokeConsent(userUuid: string) {
  await prefs.remove(key(userUuid));
  log.info('AI data sharing withdrawn');
  emit(userUuid);
}

/** Valid for this provider and disclosure version (`provider` unknown → any stored consent counts). */
export function consentValid(consent: AIConsent | null | undefined, provider?: string | null): consent is AIConsent {
  if (!consent || consent.version !== AI_CONSENT_VERSION) return false;
  return !provider || consent.provider === provider;
}

/** Display name of the provider the backend reports in `/v1/tenant/ai/status` (`anthropic`, `openai_compatible`). */
export function providerLabelKey(provider: string | null | undefined) {
  if (provider === 'anthropic') return 'mobile.ai.consent.provider_anthropic';
  if (provider === 'openai_compatible' || provider === 'openai') return 'mobile.ai.consent.provider_openai';
  return null;
}

/** Per-user consent state; updates when the consent is given or withdrawn anywhere in the app. */
export function useAIConsent(userUuid: string | undefined) {
  const [state, setState] = useState<{ user?: string; consent: AIConsent | null; loaded: boolean }>({ consent: null, loaded: false });

  useEffect(() => {
    if (!userUuid) return;
    let alive = true;
    const read = () =>
      loadConsent(userUuid).then((consent) => {
        if (alive) setState({ user: userUuid, consent, loaded: true });
      });
    void read();
    const listener = (changed: string) => {
      if (changed === userUuid) void read();
    };
    listeners.add(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, [userUuid]);

  const accept = useCallback((provider: string) => (userUuid ? saveConsent(userUuid, provider) : Promise.resolve(null)), [userUuid]);
  const revoke = useCallback(() => (userUuid ? revokeConsent(userUuid) : Promise.resolve()), [userUuid]);
  const current = state.user === userUuid;
  return { consent: current ? state.consent : null, loaded: current && state.loaded, accept, revoke };
}
