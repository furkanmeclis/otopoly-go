import { createElement } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { calendarSwatch } from '../lib/colors';
import { LAYER_DEFS } from '../lib/layers';
import type { CalendarLayer } from '../types';

/** Horizontal layer toggles in the layer's colour; the first chip shows / hides every layer. */
export function LayerChips({
  layers,
  hidden,
  counts,
  onToggle,
  onAll,
}: {
  layers: CalendarLayer[];
  hidden: ReadonlySet<CalendarLayer>;
  counts?: Record<string, number>;
  onToggle: (layer: CalendarLayer) => void;
  onAll: (visible: boolean) => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const allOn = layers.every((l) => !hidden.has(l));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm, paddingHorizontal: t.spacing.lg }}>
      <Pressable
        onPress={() => onAll(!allOn)}
        accessibilityRole="button"
        accessibilityLabel={allOn ? tr('calendar.layers.none') : tr('calendar.layers.all')}
        style={{
          height: 34,
          paddingHorizontal: t.spacing.md,
          borderRadius: t.radius.full,
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: allOn ? t.colors.text : t.colors.surface,
          justifyContent: 'center',
        }}
      >
        <Txt variant="caption" style={{ fontWeight: '700', color: allOn ? t.colors.background : t.colors.text }}>
          {tr('mobile.calendar.layers_all')}
        </Txt>
      </Pressable>
      {layers.map((layer) => {
        const def = LAYER_DEFS[layer];
        const on = !hidden.has(layer);
        const swatch = calendarSwatch(def.color, t.scheme);
        const count = counts?.[layer];
        return (
          <Pressable
            key={layer}
            onPress={() => onToggle(layer)}
            accessibilityRole="switch"
            accessibilityState={{ checked: on }}
            accessibilityLabel={tr(def.labelKey)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 34,
              paddingHorizontal: t.spacing.md,
              borderRadius: t.radius.full,
              borderWidth: 1,
              borderColor: on ? swatch.border : t.colors.border,
              backgroundColor: on ? swatch.bg : t.colors.surface,
              opacity: on ? 1 : 0.65,
            }}
          >
            {createElement(def.icon, { size: 14, color: on ? swatch.text : t.colors.textMuted })}
            <Txt variant="caption" style={{ fontWeight: '600', color: on ? swatch.text : t.colors.textSecondary }}>
              {tr(def.labelKey)}
            </Txt>
            {on && count ? (
              <Txt variant="caption" style={{ color: swatch.text, fontVariant: ['tabular-nums'], opacity: 0.8 }}>
                {count}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
