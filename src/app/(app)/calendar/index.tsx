/**
 * Calendar — web `/t/[slug]/calendar` (`features/calendar/components/calendar-page.tsx`): month grid with a
 * dot per layer + the selected day's agenda, a 3-day timeline and a 30-day agenda list. Layer chips filter
 * the feed; tapping a module item opens its record, own events open a detail sheet; long press reschedules
 * movable items (events / todos / lead follow-ups).
 */
import { useLocalSearchParams } from 'expo-router';
import { CalendarCheck, ChevronLeft, ChevronRight, EyeOff, Plus } from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, SectionList, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, EmptyState, ErrorState, Group, Header, IconButton, ListSkeleton, Section, Segmented, Txt } from '@/components/ui';
import { useDonateOnMount } from '@/features/intents/use-donate';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { EventSheet, type EventDraft } from '@/features/calendar/components/event-sheet';
import { CalendarItemRow } from '@/features/calendar/components/item-row';
import { ItemSheet } from '@/features/calendar/components/item-sheet';
import { LayerChips } from '@/features/calendar/components/layer-chips';
import { gridRange, MonthGrid, shiftMonth } from '@/features/calendar/components/month-grid';
import { RescheduleSheet } from '@/features/calendar/components/reschedule-sheet';
import { TimeGrid } from '@/features/calendar/components/time-grid';
import { dayKey, groupByDay, localDay, shiftDay } from '@/features/calendar/lib/feed';
import { openItem, useHiddenLayers } from '@/features/calendar/lib/use-calendar-ui';
import { useCalendarFeed, useCalendarMeta } from '@/features/calendar/queries';
import { CALENDAR_LAYERS, type CalendarEvent, type CalendarFeedItem, type CalendarLayer } from '@/features/calendar/types';
import { useLiveResource } from '@/features/live/use-live-resource';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type View_ = 'month' | 'days' | 'agenda';
const DAYS_IN_TIMELINE = 3;
const AGENDA_DAYS = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function CalendarScreen() {
  // Module records shown on the calendar refresh it live (`related` targets in lib/realtime/live-targets.ts).
  useLiveResource(['tenant.jobs', 'tenant.todos', 'tenant.quotes', 'tenant.leads', 'tenant.sales', 'tenant.purchases', 'tenant.finance.transactions', 'tenant.contracts.instances', 'tenant.calendar']);
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.calendarRead} title={tr('calendar.title')}>
      <CalendarView />
    </RequirePermission>
  );
}

function CalendarView() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const canWrite = can(P.calendarWrite);
  useDonateOnMount('calendarToday');
  const params = useLocalSearchParams<{ date?: string; item?: string }>();
  const today = dayKey(new Date());
  const initialDay = params.date && DAY_RE.test(params.date) ? params.date : today;

  const [view, setView] = useState<View_>('month');
  const [selected, setSelected] = useState(initialDay);
  const [month, setMonth] = useState(() => shiftMonth(localDay(initialDay), 0));
  const [detail, setDetail] = useState<CalendarFeedItem | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [moving, setMoving] = useState<CalendarFeedItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const meta = useCalendarMeta();
  const available = useMemo<CalendarLayer[]>(() => (meta.data ? meta.data.layers.map((l) => l.key) : [...CALENDAR_LAYERS]), [meta.data]);
  const { hidden, toggle, setAll } = useHiddenLayers();
  const visible = useMemo(() => available.filter((l) => !hidden.has(l)), [available, hidden]);

  const range = useMemo(() => {
    if (view === 'month') return gridRange(month);
    if (view === 'days') return { from: selected, to: shiftDay(selected, DAYS_IN_TIMELINE) };
    return { from: selected, to: shiftDay(selected, AGENDA_DAYS) };
  }, [view, month, selected]);
  const feed = useCalendarFeed(range.from, range.to, visible, meta.isSuccess);
  const byDay = useMemo(() => groupByDay(feed.data?.items ?? []), [feed.data]);

  // Deep link from the dashboard card: show that item once the feed has it (until the sheet is closed).
  const [linkClosed, setLinkClosed] = useState(false);
  const linked = !linkClosed && params.item ? (feed.data?.items.find((i) => i.id === params.item) ?? null) : null;
  const shown = detail ?? linked;

  const select = useCallback(
    (day: string) => {
      setSelected(day);
      const d = localDay(day);
      if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(shiftMonth(d, 0));
    },
    [month],
  );
  const goToday = () => select(today);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([feed.refetch(), meta.refetch()]);
    setRefreshing(false);
  }, [feed, meta]);

  const onPressItem = useCallback((item: CalendarFeedItem) => openItem(item, setDetail), []);
  const onLongPressItem = useCallback((item: CalendarFeedItem) => (item.movable ? setMoving(item) : setDetail(item)), []);
  const newEvent = (d: EventDraft) => {
    setEditing(null);
    setDraft(d);
  };

  const dayItems = byDay.get(selected) ?? [];
  const allHidden = available.length > 0 && visible.length === 0;
  const loading = meta.isLoading || (feed.isLoading && visible.length > 0);
  const error = meta.error ?? feed.error;

  const dayList = (
    <Section
      title={selected === today ? `${tr('calendar.today')} · ${fmt.date(localDay(selected), 'short')}` : new Intl.DateTimeFormat(fmt.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(localDay(selected))}
      action={canWrite ? { label: tr('calendar.new_event'), onPress: () => newEvent({ day: selected }) } : undefined}
    >
      {loading ? (
        <ListSkeleton rows={3} height={56} />
      ) : dayItems.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
          <CalendarCheck size={22} color={t.colors.textMuted} />
          <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            {selected === today ? tr('calendar.today_empty') : tr('mobile.calendar.day_empty')}
          </Txt>
        </Card>
      ) : (
        <Group>
          {dayItems.map((item, i) => (
            <CalendarItemRow key={item.id} item={item} onPress={onPressItem} onLongPress={onLongPressItem} last={i === dayItems.length - 1} />
          ))}
        </Group>
      )}
    </Section>
  );

  const agendaSections = useMemo(() => {
    if (view !== 'agenda') return [];
    const out: { day: string; data: CalendarFeedItem[] }[] = [];
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const day = shiftDay(selected, i);
      const items = byDay.get(day);
      if (items?.length) out.push({ day, data: items });
    }
    return out;
  }, [view, selected, byDay]);

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} colors={[t.colors.primary]} />;

  let body: ReactNode;
  if (error && !feed.data) {
    body = <ErrorState error={error} onRetry={onRefresh} />;
  } else if (allHidden) {
    body = (
      <EmptyState icon={<EyeOff size={28} color={t.colors.textMuted} />} title={tr('calendar.layers.title')} description={tr('calendar.layers.all_hidden')} />
    );
  } else if (view === 'month') {
    body = (
      <ScrollView refreshControl={refresh} contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.lg, paddingBottom: insets.bottom + t.spacing.xxxl }}>
        <Card style={{ paddingHorizontal: t.spacing.sm }}>
          <MonthGrid month={month} selected={selected} byDay={byDay} onSelect={select} onMonth={(delta) => setMonth((m) => shiftMonth(m, delta))} />
        </Card>
        {dayList}
      </ScrollView>
    );
  } else if (view === 'days') {
    const days = Array.from({ length: DAYS_IN_TIMELINE }, (_, i) => shiftDay(selected, i));
    body = (
      <View style={{ flex: 1, gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, paddingHorizontal: t.spacing.lg }}>
          <IconButton label={tr('calendar.prev')} icon={<ChevronLeft size={20} color={t.colors.text} />} onPress={() => select(shiftDay(selected, -DAYS_IN_TIMELINE))} />
          <Txt variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }} accessibilityLiveRegion="polite">
            {`${fmt.date(localDay(days[0]), 'short')} – ${fmt.date(localDay(days[days.length - 1]), 'short')}`}
          </Txt>
          <IconButton label={tr('calendar.next')} icon={<ChevronRight size={20} color={t.colors.text} />} onPress={() => select(shiftDay(selected, DAYS_IN_TIMELINE))} />
        </View>
        <TimeGrid
          days={days}
          byDay={byDay}
          onPressItem={onPressItem}
          onLongPressItem={onLongPressItem}
          onPressSlot={canWrite ? (day, hour) => newEvent({ day, hour }) : undefined}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </View>
    );
  } else {
    body = (
      <SectionList
        sections={agendaSections}
        keyExtractor={(item, i) => `${item.id}:${i}`}
        refreshControl={refresh}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: insets.bottom + t.spacing.xxxl }}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: t.colors.background, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: t.spacing.xs }}>
            <Txt variant="label" tone={section.day === today ? 'primary' : 'secondary'}>
              {section.day === today ? tr('calendar.today') : new Intl.DateTimeFormat(fmt.locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(localDay(section.day))}
            </Txt>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={{ marginHorizontal: t.spacing.lg, backgroundColor: t.colors.surface, borderColor: t.colors.border, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: index === 0 ? 1 : 0, borderBottomWidth: index === section.data.length - 1 ? 1 : 0, borderTopLeftRadius: index === 0 ? t.radius.lg : 0, borderTopRightRadius: index === 0 ? t.radius.lg : 0, borderBottomLeftRadius: index === section.data.length - 1 ? t.radius.lg : 0, borderBottomRightRadius: index === section.data.length - 1 ? t.radius.lg : 0, overflow: 'hidden' }}>
            <CalendarItemRow item={item} onPress={onPressItem} onLongPress={onLongPressItem} last={index === section.data.length - 1} />
          </View>
        )}
        ListEmptyComponent={loading ? <View style={{ padding: t.spacing.lg }}><ListSkeleton rows={5} height={56} /></View> : <EmptyState title={tr('calendar.empty')} description={canWrite ? tr('mobile.calendar.empty_hint') : undefined} />}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('calendar.title')}
        subtitle={fmt.date(localDay(selected), 'long')}
        right={
          <>
            <IconButton label={tr('calendar.today')} icon={<CalendarCheck size={20} color={selected === today ? t.colors.textMuted : t.colors.primary} />} onPress={goToday} />
            {canWrite ? <IconButton variant="primary" label={tr('calendar.new_event')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => newEvent({ day: selected })} /> : null}
          </>
        }
      />
      <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.md }}>
        <View style={{ paddingHorizontal: t.spacing.lg }}>
          <Segmented<View_>
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: tr('calendar.views.month') },
              { value: 'days', label: tr('mobile.calendar.views_three_days') },
              { value: 'agenda', label: tr('calendar.views.agenda') },
            ]}
          />
        </View>
        <LayerChips layers={available} hidden={hidden} counts={feed.data?.counts} onToggle={toggle} onAll={(on) => setAll(on, available)} />
      </View>
      <View style={{ flex: 1 }}>{body}</View>

      <ItemSheet
        item={shown}
        canWrite={canWrite}
        onClose={() => {
          setDetail(null);
          setLinkClosed(true);
        }}
        onEdit={(item) => {
          setDetail(null);
          setLinkClosed(true);
          if (item.event) {
            setDraft(null);
            setEditing(item.event);
          }
        }}
        onReschedule={(item) => {
          setDetail(null);
          setLinkClosed(true);
          setMoving(item);
        }}
      />
      <EventSheet
        visible={Boolean(editing || draft)}
        event={editing}
        draft={draft}
        onClose={() => {
          setEditing(null);
          setDraft(null);
        }}
      />
      <RescheduleSheet item={moving} onClose={() => setMoving(null)} />
    </SafeAreaView>
  );
}
