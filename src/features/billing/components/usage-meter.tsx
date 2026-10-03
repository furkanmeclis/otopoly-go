import { View } from 'react-native';

import { Row, Txt } from '@/components/ui';
import { isUnlimited, meterLabel, meterTone, usagePercent } from '@/features/billing/lib';
import type { BillingUsageMeter } from '@/features/billing/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/**
 * One plan limit: label, `used / limit` (or "Unlimited") and a bar that turns amber from the
 * meter's warn share (80 % by default) and red when full. Read-only — no upgrade prompt.
 */
export function UsageMeter({ meter }: { meter: BillingUsageMeter }) {
  const t = useTheme();
  const { t: tr, locale, fmt } = useLocale();
  const unlimited = isUnlimited(meter.limit);
  const tone = meterTone(meter);
  const pct = usagePercent(meter.used, meter.limit);
  const barColor = tone === 'full' ? t.colors.danger : tone === 'warn' ? t.colors.warning : t.colors.primary;
  const label = meterLabel(meter, locale);
  const value = unlimited
    ? `${fmt.number(meter.used)} · ${tr('billing.usage.unlimited')}`
    : `${fmt.number(meter.used)} / ${fmt.number(meter.limit as number)}`;
  const period = meter.period === 'day' || meter.period === 'month' || meter.period === 'total' ? tr(`billing.usage.period.${meter.period}`) : '';
  const state = tone === 'full' ? tr('mobile.plan.meter_full') : tone === 'warn' ? tr('mobile.plan.meter_warn') : '';

  return (
    <View
      style={{ gap: 6 }}
      accessible
      accessibilityLabel={[label, value, period, state].filter(Boolean).join(', ')}
      accessibilityValue={unlimited ? undefined : { min: 0, max: 100, now: pct }}
    >
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Txt variant="bodyStrong" style={{ flex: 1 }}>
          {label}
        </Txt>
        <Txt variant="caption" tone={tone === 'full' ? 'danger' : tone === 'warn' ? 'warning' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </Txt>
      </Row>
      {!unlimited ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: barColor }} />
        </View>
      ) : null}
      {period || state ? (
        <Txt variant="caption" tone={tone === 'full' ? 'danger' : tone === 'warn' ? 'warning' : 'muted'}>
          {[state, period].filter(Boolean).join(' · ')}
        </Txt>
      ) : null}
    </View>
  );
}
