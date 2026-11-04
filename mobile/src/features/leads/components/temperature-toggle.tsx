/** Cold / warm / hot switch (web `leads/components/temperature-toggle.tsx`). */
import * as Haptics from 'expo-haptics';
import { Flame, Snowflake, Sun, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Badge, Txt } from '@/components/ui';
import { TEMPERATURE_TONE } from '@/features/leads/lib/lead-ui';
import { LEAD_TEMPERATURES, type LeadTemperature } from '@/features/leads/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const ICONS: Record<LeadTemperature, LucideIcon> = { cold: Snowflake, warm: Sun, hot: Flame };

function useTempColors() {
  const t = useTheme();
  return (temp: LeadTemperature) => {
    const tone = TEMPERATURE_TONE[temp];
    return tone === 'info' ? [t.colors.info, t.colors.infoBg] : tone === 'warning' ? [t.colors.warning, t.colors.warningBg] : [t.colors.danger, t.colors.dangerBg];
  };
}

/** Read-only temperature pill. */
export function TemperatureBadge({ value }: { value: LeadTemperature }) {
  const { t: tr } = useLocale();
  const colors = useTempColors();
  const Icon = ICONS[value];
  return <Badge size="sm" tone={TEMPERATURE_TONE[value]} label={tr(`leads.temperature.${value}`)} icon={<Icon size={11} color={colors(value)[0]} />} />;
}

/** Segmented switch; one tap changes the lead. `compact` hides labels (list rows). */
export function TemperatureToggle({ value, onChange, disabled, compact }: { value: LeadTemperature; onChange: (next: LeadTemperature) => void; disabled?: boolean; compact?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const colors = useTempColors();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tr('leads.fields.temperature')} style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.full, padding: 2, alignSelf: 'flex-start' }}>
      {LEAD_TEMPERATURES.map((temp) => {
        const Icon = ICONS[temp];
        const active = temp === value;
        const [fg, bg] = colors(temp);
        return (
          <Pressable
            key={temp}
            disabled={disabled}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(temp);
            }}
            hitSlop={4}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled: Boolean(disabled) }}
            accessibilityLabel={tr(`leads.temperature.${temp}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              height: compact ? 28 : 32,
              paddingHorizontal: compact ? 8 : 12,
              borderRadius: t.radius.full,
              backgroundColor: active ? bg : 'transparent',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Icon size={compact ? 13 : 14} color={active ? fg : t.colors.textMuted} />
            {!compact ? (
              <Txt variant="caption" style={{ fontWeight: '700', color: active ? fg : t.colors.textSecondary }}>
                {tr(`leads.temperature.${temp}`)}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
