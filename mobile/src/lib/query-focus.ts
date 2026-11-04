import { focusManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * React Query decides "is the app focused" from `document.visibilityState`, which doesn't exist on
 * iOS/Android, so it always thinks the app is visible: every `refetchInterval` (operations list, unread
 * count, billing, import/export progress…) kept polling while the app sat in the background, keeping the
 * radio and CPU awake. Tie it to AppState instead: polling pauses in the background and resumes when the
 * app is active again. (`refetchOnWindowFocus` stays off by default, so coming back does not refetch
 * everything at once.)
 */
export function useAppStateQueryFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
}
