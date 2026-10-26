/**
 * Everything that must hold before the assistant can be used, shared by the conversation list and the
 * conversation screen: `tenant.ai.use`, the plan feature `ai.enabled`, the assistant being available for
 * the organization, and the user's data-sharing consent (App Store 5.1.2(i): nothing reaches the AI
 * provider before the user agreed). Renders the matching state otherwise.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui';
import { AIConsentGate } from '@/features/ai/components/consent';
import { consentValid, useAIConsent } from '@/features/ai/consent';
import { unavailableKey } from '@/features/ai/lib/labels';
import { useAIStatus } from '@/features/ai/queries';
import type { AIStatus } from '@/features/ai/types';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { useLocale } from '@/lib/i18n/provider';

/** `ready`: the assistant can be used right now (header actions show only then). */
export function useAssistantAccess() {
  const { can, me } = useAuth();
  const status = useAIStatus(can(P.aiUse));
  const consent = useAIConsent(me?.user.uuid);
  const locked = status.data?.plan_enabled === false || isFeatureDisabled(status.error);
  const available = Boolean(status.data?.available) && !locked;
  const consented = consentValid(consent.consent, status.data?.provider);
  return { status, consent, locked, available, consented, ready: available && consent.loaded && consented };
}

export function AssistantGate({ access, children }: { access: ReturnType<typeof useAssistantAccess>; children: (status: AIStatus | null) => ReactNode }) {
  const { t: tr } = useLocale();
  const { status, consent, locked, available, consented } = access;
  if (status.isLoading || (available && !consent.loaded)) {
    return (
      <View style={{ padding: 16 }}>
        <ListSkeleton rows={4} height={64} />
      </View>
    );
  }
  if (locked) return <FeatureLockedState feature="ai.enabled" />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (!available) return <EmptyState title={tr('ai.unavailable.title')} description={tr(unavailableKey(status.data?.reason))} />;
  if (!consented) return <AIConsentGate provider={status.data?.provider} onAccept={() => consent.accept(status.data?.provider ?? '')} />;
  return <>{children(status.data ?? null)}</>;
}
