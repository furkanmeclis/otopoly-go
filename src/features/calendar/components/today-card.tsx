/** Home dashboard card: today and the next days from the calendar (web `upcoming-widget.tsx`). */
import { router } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import { Group, Row, Section, Skeleton, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { useNow } from '@/features/jobs/components/job-parts';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { addDays, businessNow, dayKey, itemStart, localDay, startOfDay } from '../lib/feed';
import { openItem } from '../lib/use-calendar-ui';
import { useCalendarFeed } from '../queries';
import type { CalendarFeedItem, CalendarLayer } from '../types';
import { CalendarItemRow } from './item-row';

/** Forward-looking layers (jobs / sales are records of what happened). */
const UPCOMING_LAYERS: CalendarLayer[] = ['events', 'todos', 'quotes', 'leads'];
const DAYS = 7;
const MAX_ROWS = 6;

export function CalendarTodayCard() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const canRead = can(P.calendarRead);
  const now = useNow(60_000);
  const today = useMemo(() => startOfDay(businessNow(now)), [now]);
  const from = dayKey(today);
  const feed = useCalendarFeed(from, dayKey(addDays(today, DAYS)), UPCOMING_LAYERS, canRead);

  const groups = useMemo(() => {
    const items = (feed.data?.items ?? [])
      .filter((i) => i.status !== 'done')
      .filter((i) => i.all_day || new Date(i.ends_at).getTime() >= now)
      .sort((a, b) => itemStart(a).getTime() - itemStart(b).getTime() || Number(b.all_day) - Number(a.all_day))
      .slice(0, MAX_ROWS);
    const out: { day: string; items: CalendarFeedItem[] }[] = [];
    for (const item of items) {
      const start = itemStart(item);
      const day = dayKey(start < today ? today : start);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [feed.data, today, now]);

  if (!canRead) return null;
  const openCalendar = (day?: string, item?: string) => router.push(day ? { pathname: '/calendar', params: item ? { date: day, item } : { date: day } } : '/calendar');
  const dayLabel = (day: string) => {
    if (day === from) return tr('calendar.today');
    if (day === dayKey(addDays(today, 1))) return tr('calendar.tomorrow');
    return new Intl.DateTimeFormat(fmt.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(localDay(day));
  };

  return (
    <Section title={tr('calendar.widget.title')} action={{ label: tr('calendar.widget.open'), onPress: () => openCalendar() }}>
      <Group>
        {feed.isLoading ? (
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={36} />
            ))}
          </View>
        ) : feed.isError ? (
          <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.xl, textAlign: 'center' }}>
            {tr('calendar.error.title')}
          </Txt>
        ) : groups.length === 0 ? (
          <Row gap={t.spacing.sm} style={{ padding: t.spacing.xl, justifyContent: 'center' }}>
            <CalendarDays size={18} color={t.colors.textMuted} />
            <Txt tone="secondary" variant="caption">
              {tr('calendar.widget.empty')}
            </Txt>
          </Row>
        ) : (
          groups.map((group, gi) => (
            <View key={group.day}>
              <Txt
                variant="label"
                tone={group.day === from ? 'primary' : 'muted'}
                style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: 2, borderTopWidth: gi ? 1 : 0, borderTopColor: t.colors.border }}
                onPress={() => openCalendar(group.day)}
              >
                {dayLabel(group.day)}
              </Txt>
              {group.items.map((item, i) => (
                <CalendarItemRow key={item.id} item={item} last={i === group.items.length - 1} onPress={(it) => openItem(it, () => openCalendar(group.day, it.id))} />
              ))}
            </View>
          ))
        )}
      </Group>
    </Section>
  );
}
