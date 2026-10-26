import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { calendarSwatch } from '../lib/colors';
import { dayKey, describe, isMuted, layoutDay, localDay } from '../lib/feed';
import { itemColor, LAYER_DEFS } from '../lib/layers';
import type { CalendarFeedItem } from '../types';

const HOUR = 52;
const GUTTER = 44;
const FIRST_VISIBLE_HOUR = 7;

/**
 * Multi-day timeline (3 days on phones): all-day items on top, timed items positioned by time in
 * side-by-side lanes when they overlap, a line at the current time. Tapping an empty hour starts a new
 * event there (when allowed); long-pressing a movable item reschedules it.
 */
export function TimeGrid({
  days,
  byDay,
  onPressItem,
  onLongPressItem,
  onPressSlot,
  refreshing,
  onRefresh,
}: {
  days: string[];
  byDay: Map<string, CalendarFeedItem[]>;
  onPressItem: (item: CalendarFeedItem) => void;
  onLongPressItem: (item: CalendarFeedItem) => void;
  onPressSlot?: (day: string, hour: number) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const hour = days.includes(dayKey(new Date())) ? Math.max(0, new Date().getHours() - 2) : FIRST_VISIBLE_HOUR;
    const id = setTimeout(() => scroll.current?.scrollTo({ y: hour * HOUR, animated: false }), 0);
    return () => clearTimeout(id);
  }, [days]);

  const headerFormat = useMemo(() => new Intl.DateTimeFormat(fmt.locale, { weekday: 'short' }), [fmt.locale]);
  const today = dayKey(now);
  const allDayRows = days.map((d) => (byDay.get(d) ?? []).filter((i) => i.all_day));
  const hasAllDay = allDayRows.some((r) => r.length);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', paddingLeft: GUTTER, borderBottomWidth: 1, borderBottomColor: t.colors.border, paddingBottom: t.spacing.xs }}>
        {days.map((d) => {
          const date = localDay(d);
          const isToday = d === today;
          return (
            <View key={d} style={{ flex: 1, alignItems: 'center', gap: 2 }} accessibilityRole="header" accessibilityLabel={fmt.date(date, 'long')}>
              <Txt variant="caption" tone={isToday ? 'primary' : 'secondary'} style={{ fontWeight: '700', textTransform: 'capitalize' }}>
                {headerFormat.format(date)}
              </Txt>
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: isToday ? t.colors.primary : 'transparent' }}>
                <Txt variant="bodyStrong" style={{ color: isToday ? t.colors.onPrimary : t.colors.text, fontVariant: ['tabular-nums'] }}>
                  {date.getDate()}
                </Txt>
              </View>
            </View>
          );
        })}
      </View>
      {hasAllDay ? (
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.colors.border, paddingVertical: 4 }}>
          <Txt variant="caption" tone="muted" style={{ width: GUTTER, textAlign: 'center', fontSize: 10 }} numberOfLines={2}>
            {tr('calendar.all_day')}
          </Txt>
          {allDayRows.map((items, i) => (
            <View key={days[i]} style={{ flex: 1, gap: 2, paddingHorizontal: 2 }}>
              {items.slice(0, 3).map((item) => (
                <Block key={item.id} item={item} compact onPress={onPressItem} onLongPress={onLongPressItem} />
              ))}
              {items.length > 3 ? (
                <Txt variant="caption" tone="muted" style={{ fontSize: 10, textAlign: 'center' }}>
                  {tr('calendar.more', { count: items.length - 3 })}
                </Txt>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + t.spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} colors={[t.colors.primary]} />}
      >
        <View style={{ flexDirection: 'row', height: HOUR * 24 }}>
          <View style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) => (
              <Txt key={h} variant="caption" tone="muted" style={{ position: 'absolute', top: h * HOUR - 7, right: 6, fontSize: 11, fontVariant: ['tabular-nums'] }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </Txt>
            ))}
          </View>
          {days.map((d) => (
            <DayColumn
              key={d}
              day={d}
              items={byDay.get(d) ?? []}
              now={d === today ? now : null}
              onPressItem={onPressItem}
              onLongPressItem={onLongPressItem}
              onPressSlot={onPressSlot}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function DayColumn({
  day,
  items,
  now,
  onPressItem,
  onLongPressItem,
  onPressSlot,
}: {
  day: string;
  items: CalendarFeedItem[];
  now: Date | null;
  onPressItem: (item: CalendarFeedItem) => void;
  onLongPressItem: (item: CalendarFeedItem) => void;
  onPressSlot?: (day: string, hour: number) => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const laid = useMemo(() => layoutDay(items, day), [items, day]);
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: t.colors.border }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {Array.from({ length: 24 }, (_, h) => (
        <Pressable
          key={h}
          disabled={!onPressSlot}
          onPress={() => onPressSlot?.(day, h)}
          accessibilityRole={onPressSlot ? 'button' : undefined}
          accessibilityLabel={onPressSlot ? `${tr('calendar.new_event')} ${fmt.date(localDay(day), 'medium')} ${String(h).padStart(2, '0')}:00` : undefined}
          style={({ pressed }) => ({ height: HOUR, borderTopWidth: h === 0 ? 0 : 1, borderTopColor: t.colors.border, backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent' })}
        />
      ))}
      {width > 0
        ? laid.map(({ item, top, bottom, lane, lanes }) => {
            const w = (width - 4) / lanes;
            return (
              <View key={item.id} style={{ position: 'absolute', top: (top / 60) * HOUR + 1, height: Math.max(22, ((bottom - top) / 60) * HOUR - 2), left: 2 + lane * w, width: w - 2 }}>
                <Block item={item} onPress={onPressItem} onLongPress={onLongPressItem} />
              </View>
            );
          })
        : null}
      {now ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR, height: 2, backgroundColor: t.colors.danger }}>
          <View style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.danger }} />
        </View>
      ) : null}
    </View>
  );
}

function Block({ item, compact, onPress, onLongPress }: { item: CalendarFeedItem; compact?: boolean; onPress: (item: CalendarFeedItem) => void; onLongPress: (item: CalendarFeedItem) => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const swatch = calendarSwatch(itemColor(item), t.scheme);
  const { title, subtitle } = describe(item, tr, fmt.money);
  const muted = isMuted(item);
  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${tr(LAYER_DEFS[item.layer].labelKey)}: ${title}`}
      accessibilityHint={item.movable ? tr('mobile.calendar.long_press_hint') : undefined}
      style={({ pressed }) => ({
        flex: compact ? undefined : 1,
        minHeight: compact ? 22 : undefined,
        borderRadius: 6,
        borderLeftWidth: 3,
        borderLeftColor: swatch.solid,
        backgroundColor: swatch.bg,
        paddingHorizontal: 4,
        paddingVertical: 2,
        overflow: 'hidden',
        opacity: pressed ? 0.75 : muted ? 0.55 : 1,
        flexDirection: 'row',
        gap: 3,
      })}
    >
      {compact ? createElement(LAYER_DEFS[item.layer].icon, { size: 11, color: swatch.text, style: { marginTop: 2 } }) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt numberOfLines={compact ? 1 : 2} style={{ fontSize: 11, fontWeight: '700', color: swatch.text, textDecorationLine: muted ? 'line-through' : 'none' }}>
          {title}
        </Txt>
        {!compact && subtitle ? (
          <Txt numberOfLines={1} style={{ fontSize: 10, color: swatch.text, opacity: 0.8 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}
