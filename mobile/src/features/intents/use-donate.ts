import { useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-provider';

import { donateIntent } from './bridge';
import type { DonatableName } from './catalog';

/**
 * Donates once when the screen opens (throttled in `shouldDonate`), so Siri learns which shortcuts this
 * member uses. No-op without App Intents.
 */
export function useDonateOnMount(name: DonatableName, customerId?: string | null, enabled = true) {
  const { can } = useAuth();
  useEffect(() => {
    if (!enabled) return;
    if (name === 'openCustomer' && !customerId) return;
    void donateIntent({ name, ...(customerId ? { customerId } : {}) }, can);
    // `can` changes identity on every auth render; the donation is about this screen visit only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, customerId, enabled]);
}

/** For actions (job created, QR scanned): call the returned function after the action succeeded. */
export function useDonate() {
  const { can } = useAuth();
  return (name: DonatableName) => void donateIntent({ name }, can);
}
