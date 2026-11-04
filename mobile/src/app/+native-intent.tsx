/**
 * Rewrites incoming universal links / `otopoly://` URLs before Expo Router matches them.
 * Web addresses (`/t/{slug}/...`) don't match app routes 1:1 and may belong to another organization,
 * so they go through `/link`, which knows the session. Runs outside React: never throw here.
 */
import { rewriteSystemPath } from '@/features/notifications/deep-links';
import { markInitialNativeIntent } from '@/features/intro/initial-link';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (initial) markInitialNativeIntent();
    return rewriteSystemPath(path);
  } catch {
    return '/';
  }
}
