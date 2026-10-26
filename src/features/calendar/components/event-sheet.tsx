/** Create / edit an own calendar event (web `features/calendar/components/event-dialog.tsx`). */
import { Check, Trash2 } from 'lucide-react-native';
import { businessWallClock, wallClockToISO } from '@/lib/business-date';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, DateField, Field, Sheet, SwitchRow, TextField, useConfirm } from '@/components/ui';
import { createLogger } from '@/lib/logger';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { calendarSwatch } from '../lib/colors';
import { addDays, businessNow, dayKey, hhmm, localDay } from '../lib/feed';
import { COLOR_LABEL_KEYS } from '../lib/layers';
import { useCalendarMutations } from '../queries';
import { CALENDAR_COLORS, type CalendarColor, type CalendarEvent, type CalendarEventInput } from '../types';

const log = createLogger('screen.calendar-event');

/** Prefill for a new event (selected day, tapped hour). */
export type EventDraft = { day: string; hour?: number; allDay?: boolean };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Edit mode when set. */
  event?: CalendarEvent | null;
  draft?: EventDraft | null;
};

export function EventSheet(props: Props) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.event ? tr('calendar.event.edit_title') : tr('calendar.event.create_title')}>
      <EventForm key={`${props.visible ? 'open' : 'closed'}:${props.event?.uuid ?? 'new'}`} {...props} />
    </Sheet>
  );
}

function initial(event?: CalendarEvent | null, draft?: EventDraft | null) {
  if (event) {
    const start = businessWallClock(event.starts_at);
    const end = businessWallClock(event.ends_at);
    return {
      title: event.title,
      allDay: event.all_day,
      startDate: event.start_date ?? dayKey(start),
      endDate: event.end_date ?? dayKey(end),
      startTime: event.all_day ? '09:00' : hhmm(start),
      endTime: event.all_day ? '10:00' : hhmm(end),
      location: event.location,
      description: event.description,
      color: event.color,
    };
  }
  const now = businessNow();
  const day = draft?.day ?? dayKey(now);
  const hour = draft?.hour ?? Math.min(22, now.getHours() + 1);
  const start = localDay(day);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  return {
    title: '',
    allDay: draft?.allDay ?? false,
    startDate: day,
    endDate: draft?.allDay ? day : dayKey(end),
    startTime: hhmm(start),
    endTime: hhmm(end),
    location: '',
    description: '',
    color: 'blue' as CalendarColor,
  };
}

const at = (day: string, time: string) => {
  const d = localDay(day);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

function EventForm({ onClose, event, draft }: Props) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const confirm = useConfirm();
  const { create, update, remove } = useCalendarMutations();
  const [v, setV] = useState(() => initial(event, draft));
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [key]: value }));
  const pending = create.isPending || update.isPending;

  const titleError = touched && !v.title.trim() ? tr('calendar.event.validation.title') : null;
  const rangeOk = v.allDay ? v.endDate >= v.startDate : at(v.endDate, v.endTime) > at(v.startDate, v.startTime);
  const rangeError = rangeOk ? null : tr('calendar.event.validation.range');

  /** Keep the end after the start when the start moves (same length for timed events). */
  const moveStart = (day: string | null, time?: string | null) => {
    if (!day) return;
    setV((s) => {
      const nextTime = time ?? s.startTime;
      if (s.allDay) {
        const span = Math.round((localDay(s.endDate).getTime() - localDay(s.startDate).getTime()) / 86400000);
        return { ...s, startDate: day, endDate: dayKey(addDays(localDay(day), Math.max(0, span))) };
      }
      const length = Math.max(15 * 60000, at(s.endDate, s.endTime).getTime() - at(s.startDate, s.startTime).getTime());
      const end = new Date(at(day, nextTime).getTime() + length);
      return { ...s, startDate: day, startTime: nextTime, endDate: dayKey(end), endTime: hhmm(end) };
    });
  };

  const submit = () => {
    setTouched(true);
    if (!v.title.trim() || !rangeOk) return;
    const body: CalendarEventInput = {
      title: v.title.trim(),
      all_day: v.allDay,
      color: v.color,
      location: v.location.trim(),
      description: v.description.trim(),
      ...(v.allDay
        ? { start_date: v.startDate, end_date: v.endDate }
        : { starts_at: wallClockToISO(at(v.startDate, v.startTime)), ends_at: wallClockToISO(at(v.endDate, v.endTime)) }),
    };
    if (event) update.mutate({ uuid: event.uuid, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
    log.info(event ? 'Event update submitted' : 'Event create submitted', { uuid: event?.uuid, allDay: v.allDay });
  };

  return (
    <>
      <TextField
        label={tr('calendar.event.title')}
        placeholder={tr('calendar.event.title_placeholder')}
        value={v.title}
        onChangeText={(s) => set('title', s)}
        maxLength={200}
        autoFocus={!event}
        required
        error={titleError}
        returnKeyType="done"
      />
      <SwitchRow label={tr('calendar.event.all_day')} value={v.allDay} onValueChange={(on) => set('allDay', on)} />
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('calendar.event.start_date')} value={v.startDate} onChange={(d) => moveStart(d)} />
        </View>
        {!v.allDay ? (
          <View style={{ width: 120 }}>
            <DateField label={tr('calendar.event.start_time')} mode="time" value={v.startTime} onChange={(time) => time && moveStart(v.startDate, time)} />
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('calendar.event.end_date')} value={v.endDate} onChange={(d) => d && set('endDate', d)} minimumDate={localDay(v.startDate)} error={rangeError} />
        </View>
        {!v.allDay ? (
          <View style={{ width: 120 }}>
            <DateField label={tr('calendar.event.end_time')} mode="time" value={v.endTime} onChange={(time) => time && set('endTime', time)} />
          </View>
        ) : null}
      </View>
      <TextField label={tr('calendar.event.location')} value={v.location} onChangeText={(s) => set('location', s)} maxLength={200} />
      <TextField label={tr('calendar.event.description')} value={v.description} onChangeText={(s) => set('description', s)} multiline maxLength={2000} />
      <ColorPicker value={v.color} onChange={(c) => set('color', c)} />

      <View style={{ gap: t.spacing.sm, marginTop: t.spacing.sm }}>
        <Button size="lg" label={pending ? tr('common.saving') : tr('common.save')} loading={pending} onPress={submit} />
        {event ? (
          <Button
            variant="outline"
            label={tr('calendar.event.delete')}
            icon={<Trash2 size={16} color={t.colors.danger} />}
            loading={remove.isPending}
            onPress={async () => {
              if (await confirm({ title: event.title, message: tr('calendar.event.delete_confirm', { title: event.title }), destructive: true, confirmLabel: tr('common.delete') })) {
                remove.mutate(event.uuid, { onSuccess: onClose });
              }
            }}
          />
        ) : null}
      </View>
    </>
  );
}

function ColorPicker({ value, onChange }: { value: CalendarColor; onChange: (c: CalendarColor) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Field label={tr('calendar.event.color')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }} accessibilityRole="radiogroup">
        {CALENDAR_COLORS.map((c) => {
          const selected = c === value;
          const swatch = calendarSwatch(c, t.scheme);
          return (
            <Pressable
              key={c}
              onPress={() => onChange(c)}
              accessibilityRole="radio"
              accessibilityLabel={tr(COLOR_LABEL_KEYS[c])}
              accessibilityState={{ selected }}
              hitSlop={4}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: selected ? t.colors.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: swatch.solid, alignItems: 'center', justifyContent: 'center' }}>
                {selected ? <Check size={16} color="#fff" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}
