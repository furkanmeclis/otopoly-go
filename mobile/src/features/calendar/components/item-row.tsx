import { createElement, memo } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { calendarSwatch } from '../lib/colors';
import { describe, isMuted, itemStart } from '../lib/feed';
import { itemColor, LAYER_DEFS } from '../lib/layers';
import type { CalendarFeedItem } from '../types';

/** One feed item: layer chip (colour + icon), title / subtitle, time or "all day". */
export const CalendarItemRow = memo(function CalendarItemRow({
  item,
  onPress,
  onLongPress,
  showTime = true,
  last,
}: {
  item: CalendarFeedItem;
  onPress?: (item: CalendarFeedItem) => void;
  onLongPress?: (item: CalendarFeedItem) => void;
  showTime?: boolean;
  last?: boolean;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const def = LAYER_DEFS[item.layer];
  const swatch = calendarSwatch(itemColor(item), t.scheme);
  const { title, subtitle } = describe(item, tr, fmt.money);
  const muted = isMuted(item);
  const when = item.all_day ? tr('calendar.all_day') : fmt.time(itemStart(item));
  return (
    <Pressable
      onPress={onPress ? () => onPress(item) : undefined}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${tr(def.labelKey)}: ${title}${subtitle ? `, ${subtitle}` : ''}, ${when}`}
      accessibilityHint={item.movable && onLongPress ? tr('mobile.calendar.long_press_hint') : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        minHeight: 56,
        backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.border,
      })}
    >
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: swatch.solid, opacity: muted ? 0.4 : 1 }} />
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: swatch.bg, alignItems: 'center', justifyContent: 'center' }}>
        {createElement(def.icon, { size: 17, color: swatch.text })}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={muted ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {showTime ? (
        <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'], fontWeight: '600' }}>
          {when}
        </Txt>
      ) : null}
    </Pressable>
  );
});
