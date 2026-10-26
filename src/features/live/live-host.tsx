import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { env, isMock } from '@/config/env';
import { useAuth } from '@/features/auth/auth-provider';
import { createCentrifugeDriver } from '@/lib/realtime/centrifuge-driver';
import { liveHub } from '@/lib/realtime/live-hub';
import { createMockDriver } from '@/lib/realtime/mock-driver';

/**
 * Owns the shared live-update connection of the signed-in organization (mounted once in the `(app)`
 * layout): connects when an organization is active, reconnects on organization switch, closes on sign-out,
 * pauses in the background and resumes (with one refetch) in the foreground. Demo mode uses a silent fake.
 */
export function LiveHost() {
  const qc = useQueryClient();
  const { status, organization } = useAuth();
  const orgUuid = status === 'ready' ? (organization?.uuid ?? null) : null;

  useEffect(() => {
    liveHub.setQueryClient(qc);
    return () => liveHub.setQueryClient(null);
  }, [qc]);

  useEffect(() => {
    if (!orgUuid || !env.realtimeEnabled) return;
    liveHub.start(orgUuid, isMock ? createMockDriver : createCentrifugeDriver);
    if (AppState.currentState !== 'active' && AppState.currentState !== 'unknown') liveHub.pause();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') liveHub.resume();
      else if (state === 'background') liveHub.pause();
    });
    return () => {
      sub.remove();
      liveHub.stop();
    };
  }, [orgUuid]);

  return null;
}
