import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { memo, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Directions, GestureDetector, useCompetingGestures, useFlingGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { IconButton, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { calendarSwatch } from '../lib/colors';
import { addDays, dayKey, monthGrid } from '../lib/feed';
import { itemColor } from '../lib/layers';
import type { CalendarFeedItem } from '../types';

const MAX_DOTS = 3;

/** Monday-first month grid: up to three colour dots per day, today ringed, the selected day filled. Swipe to change month. */
export function MonthGrid({
  month,
  selected,
  byDay,
  onSelect,
  onMonth,
}: {
  month: Date;
  selected: string;
  byDay: Map<string, CalendarFeedItem[]>;
  onSelect: (day: string) => void;
  onMonth: (delta: number) => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const reduceMotion = useReducedMotion();
  const days = useMemo(() => monthGrid(month), [month]);
  const today = dayKey(new Date());
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(fmt.locale, { weekday: 'narrow' });
    return days.slice(0, 7).map((d) => f.format(d));
  }, [days, fmt.locale]);
  const title = useMemo(() => new Intl.DateTimeFormat(fmt.locale, { month: 'long', year: 'numeric' }).format(month), [month, fmt.locale]);

  const next = useFlingGesture({ direction: Directions.LEFT, runOnJS: true, onActivate: () => onMonth(1) });
  const prev = useFlingGesture({ direction: Directions.RIGHT, runOnJS: true, onActivate: () => onMonth(-1) });
  const fling = useCompetingGestures(next, prev);

  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Txt variant="heading" style={{ flex: 1, textTransform: 'capitalize' }} accessibilityRole="header" accessibilityLiveRegion="polite">
          {title}
        </Txt>
        <IconButton label={tr('calendar.prev')} icon={<ChevronLeft size={20} color={t.colors.text} />} onPress={() => onMonth(-1)} />
        <IconButton label={tr('calendar.next')} icon={<ChevronRight size={20} color={t.colors.text} />} onPress={() => onMonth(1)} />
      </View>
      <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {weekdays.map((w, i) => (
          <Txt key={i} variant="caption" tone={i >= 5 ? 'muted' : 'secondary'} style={{ flex: 1, textAlign: 'center', fontWeight: '700' }}>
            {w}
          </Txt>
        ))}
      </View>
      <GestureDetector gesture={fling}>
        <Animated.View key={dayKey(month)} entering={reduceMotion ? undefined : FadeIn.duration(180)} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {days.map((d) => {
            const key = dayKey(d);
            return (
              <DayCell
                key={key}
                day={key}
                date={d.getDate()}
                inMonth={d.getMonth() === month.getMonth()}
                isToday={key === today}
                isSelected={key === selected}
                items={byDay.get(key)}
                label={fmt.date(d, 'long')}
                onSelect={onSelect}
              />
            );
          })}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const DayCell = memo(function DayCell({
  day,
  date,
  inMonth,
  isToday,
  isSelected,
  items,
  label,
  onSelect,
}: {
  day: string;
  date: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  items: CalendarFeedItem[] | undefined;
  label: string;
  onSelect: (day: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const colors = useMemo(() => {
    const out: string[] = [];
    for (const item of items ?? []) {
      const c = calendarSwatch(itemColor(item), t.scheme).solid;
      if (!out.includes(c)) out.push(c);
      if (out.length >= MAX_DOTS) break;
    }
    return out;
  }, [items, t.scheme]);
  const count = items?.length ?? 0;
  return (
    <Pressable
      onPress={() => onSelect(day)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${label}${count ? `, ${tr('mobile.calendar.items_count', { count })}` : ''}`}
      style={{ width: `${100 / 7}%`, height: 50, alignItems: 'center', paddingTop: 4, gap: 3 }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isSelected ? t.colors.primary : 'transparent',
          borderWidth: isToday && !isSelected ? 1.5 : 0,
          borderColor: t.colors.primary,
        }}
      >
        <Txt
          variant="bodyStrong"
          style={{
            fontVariant: ['tabular-nums'],
            color: isSelected ? t.colors.onPrimary : isToday ? t.colors.primary : inMonth ? t.colors.text : t.colors.textMuted,
            opacity: inMonth || isSelected ? 1 : 0.6,
          }}
        >
          {date}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
        {colors.map((c) => (
          <View key={c} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c, opacity: inMonth ? 1 : 0.5 }} />
        ))}
      </View>
    </Pressable>
  );
});

/** First day of the month `delta` months from `month`. */
export const shiftMonth = (month: Date, delta: number) => new Date(month.getFullYear(), month.getMonth() + delta, 1);
/** `[from, to)` covering the 6-week grid of `month`. */
export function gridRange(month: Date) {
  const days = monthGrid(month);
  return { from: dayKey(days[0]), to: dayKey(addDays(days[41], 1)) };
}
