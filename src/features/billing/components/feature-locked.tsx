import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';

import { Button, EmptyState } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { featureLockedMessageKey, moduleName, type LockedModule } from '@/features/billing/lib';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/**
 * Shared `403 FEATURE_DISABLED` state for modules the organization's plan turns off
 * (reports, contracts, contract templates, assistant). Neutral copy with owner / staff variants;
 * never offers an upgrade or purchase.
 */
export function FeatureLockedState({ feature }: { feature: LockedModule }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { isOwner, can } = useAuth();
  return (
    <EmptyState
      icon={<Lock size={28} color={t.colors.textMuted} />}
      title={tr('mobile.plan.locked.title')}
      description={tr(featureLockedMessageKey(isOwner), { feature: moduleName(tr, feature) })}
      action={can(P.billingRead) ? <Button label={tr('mobile.plan.limit.view_usage')} variant="outline" size="sm" onPress={() => router.push('/settings/usage')} /> : undefined}
    />
  );
}
