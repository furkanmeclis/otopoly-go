import { router } from 'expo-router';
import { useEffect } from 'react';

import { takeLinkIntent } from '@/features/account/link-intent';
import { createLogger } from '@/lib/logger';

const log = createLogger('account.link');

/** Mounted in the signed-in layout: replays a "link it from your profile" hint from the sign-in screen. */
export function LinkIntentHost() {
  useEffect(() => {
    const provider = takeLinkIntent();
    if (!provider) return;
    log.info('Opening linked accounts after sign-in', { provider });
    // Let the tab navigator mount first.
    const timer = setTimeout(() => router.push({ pathname: '/profile/linked-accounts', params: { provider } }), 400);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
