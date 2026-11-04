/**
 * Reschedule a movable item (long press): own events keep their length, todos take a date and an optional
 * time (no time = all-day), lead follow-ups only have a date. Uses the same date pickers as the rest of the app.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Button, DateField, Sheet, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { dayKey, describe, hhmm, itemStart, moveBody } from '../lib/feed';
import { useCalendarMutations } from '../queries';
import type { CalendarFeedItem } from '../types';

export function RescheduleSheet({ item, onClose }: { item: CalendarFeedItem | null; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={Boolean(item)} onClose={onClose} title={tr('mobile.calendar.reschedule.title')}>
      {item ? <RescheduleForm key={item.id} item={item} onClose={onClose} /> : null}
    </Sheet>
  );
}

function RescheduleForm({ item, onClose }: { item: CalendarFeedItem; onClose: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { move } = useCalendarMutations();
  const start = itemStart(item);
  const [day, setDay] = useState(item.all_day && item.start_date ? item.start_date : dayKey(start));
  const [time, setTime] = useState<string | null>(item.all_day ? null : hhmm(start));
  const { title } = describe(item, tr, fmt.money);
  const withTime = item.layer !== 'leads';
  const timeOptional = item.layer === 'todos';
  const hint = item.layer === 'leads' ? tr('mobile.calendar.reschedule.lead_hint') : item.layer === 'todos' ? tr('mobile.calendar.reschedule.todo_hint') : null;

  return (
    <>
      <Txt variant="heading" numberOfLines={2}>
        {title}
      </Txt>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('mobile.calendar.reschedule.date')} value={day} onChange={(d) => d && setDay(d)} />
        </View>
        {withTime && (time !== null || timeOptional) ? (
          <View style={{ width: 130 }}>
            <DateField label={tr('mobile.calendar.reschedule.time')} mode="time" value={time} onChange={setTime} allowClear={timeOptional} />
          </View>
        ) : null}
      </View>
      {hint ? (
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      ) : null}
      <Button
        size="lg"
        label={tr('mobile.calendar.reschedule.save')}
        loading={move.isPending}
        onPress={() => {
          move.mutate({ item, body: moveBody(item, day, withTime ? time : null) });
          onClose();
        }}
      />
    </>
  );
}
