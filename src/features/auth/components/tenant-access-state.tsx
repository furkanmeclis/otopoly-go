import { Ban, Clock, ShieldOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { accessCopyKeys, type TenantAccess } from '@/features/auth/lib/access';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export type { TenantAccess };

/**
 * Neutral "you can't open this business" state. Never mentions buying, renewing or upgrading:
 * the owner is told the details went to their e-mail, staff to ask their manager.
 */
export function TenantAccessState({ state, orgName, isOwner, actions }: { state: TenantAccess; orgName?: string; isOwner: boolean; actions?: ReactNode }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const keys = accessCopyKeys(state, isOwner);
  const Icon = state === 'denied' ? ShieldOff : state === 'expired' ? Clock : Ban;
  return (
    <View style={{ alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.xxl, paddingHorizontal: t.spacing.lg }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={28} color={t.colors.textMuted} />
      </View>
      <Txt variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>
        {tr(keys.title)}
      </Txt>
      <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 340 }} accessibilityLiveRegion="polite">
        {tr(keys.body, { name: orgName ?? '' })}
      </Txt>
      {actions ? <View style={{ alignSelf: 'stretch', gap: t.spacing.sm, marginTop: t.spacing.md }}>{actions}</View> : null}
    </View>
  );
}
