import { Gift } from 'lucide-react-native';
import { View } from 'react-native';

import { Badge, Row, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { rewardLabel } from '../lib/labels';
import type { StampCard } from '../types';

const MAX_DOTS = 12;

/** A customer's stamp card: progress dots towards the next reward (web `stamp-card.tsx`). */
export function StampCardView({ card }: { card: StampCard }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const dots = Math.min(card.stamps_required, MAX_DOTS);
  const filled = card.stamps_required > MAX_DOTS ? Math.round((card.stamps / card.stamps_required) * MAX_DOTS) : card.stamps;
  return (
    <View
      style={{ gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface }}
      accessible
      accessibilityLabel={`${card.campaign_name}: ${tr('loyalty.stamps.progress', { stamps: card.stamps, required: card.stamps_required })}`}
    >
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {card.campaign_name}
        </Txt>
        {card.rewards_available > 0 ? (
          <Badge size="sm" tone="success" icon={<Gift size={12} color={t.colors.success} />} label={tr('loyalty.stamps.ready', { count: card.rewards_available })} />
        ) : (
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {tr('loyalty.stamps.progress', { stamps: card.stamps, required: card.stamps_required })}
          </Txt>
        )}
      </Row>
      <Row gap={6} wrap>
        {Array.from({ length: dots }, (_, i) => (
          <View
            key={i}
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              borderWidth: 1.5,
              borderColor: i < filled ? t.colors.primary : t.colors.borderStrong,
              backgroundColor: i < filled ? t.colors.primary : 'transparent',
            }}
          />
        ))}
      </Row>
      <Txt variant="caption" tone="muted">
        {rewardLabel(tr, fmt.money, card)}
        {!card.active ? ` · ${tr('loyalty.stamps.inactive')}` : card.limit_reached ? ` · ${tr('loyalty.stamps.limit_reached')}` : ''}
      </Txt>
    </View>
  );
}
