/** Summary of a calendar item (web `item-dialog.tsx`), with open / reschedule / edit actions. */
import { router } from 'expo-router';
import { ArrowUpRight, CalendarClock, MapPin, Pencil, Trash2 } from 'lucide-react-native';
import { createElement } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, InfoRow, Row, Sheet, Txt, useConfirm } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { calendarSwatch } from '../lib/colors';
import { addDays, describe, isMuted, itemEnd, itemStart, sameDay } from '../lib/feed';
import { itemColor, LAYER_DEFS, statusKey } from '../lib/layers';
import { useCalendarMutations } from '../queries';
import type { CalendarFeedItem } from '../types';

export function ItemSheet({
  item,
  onClose,
  canWrite,
  onEdit,
  onReschedule,
}: {
  item: CalendarFeedItem | null;
  onClose: () => void;
  canWrite: boolean;
  onEdit: (item: CalendarFeedItem) => void;
  onReschedule: (item: CalendarFeedItem) => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const { remove } = useCalendarMutations();
  if (!item) return <Sheet visible={false} onClose={onClose} title="">{null}</Sheet>;

  const def = LAYER_DEFS[item.layer];
  const swatch = calendarSwatch(itemColor(item), t.scheme);
  const { title, subtitle } = describe(item, tr, fmt.money);
  const start = itemStart(item);
  const lastDay = addDays(itemEnd(item), -1);
  const when = item.all_day
    ? sameDay(start, lastDay)
      ? `${fmt.date(start, 'long')} · ${tr('calendar.all_day')}`
      : `${fmt.date(start, 'medium')} – ${fmt.date(lastDay, 'medium')}`
    : `${fmt.date(start, 'long')} · ${fmt.time(start)}${item.layer === 'events' ? ` – ${fmt.time(itemEnd(item))}` : ''}`;
  const href = def.href(item);
  const sKey = statusKey(item.status);
  const isEvent = item.layer === 'events';
  const event = item.event;

  return (
    <Sheet visible onClose={onClose} title={tr(def.labelKey)}>
      <Card style={{ gap: t.spacing.sm, borderLeftWidth: 4, borderLeftColor: swatch.solid }}>
        <Row gap={t.spacing.sm}>
          <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: swatch.bg, alignItems: 'center', justifyContent: 'center' }}>
            {createElement(def.icon, { size: 16, color: swatch.text })}
          </View>
          <Txt variant="label" tone="secondary">
            {tr(def.labelKey)}
          </Txt>
        </Row>
        <Txt variant="title" style={isMuted(item) ? { textDecorationLine: 'line-through', opacity: 0.7 } : undefined}>
          {title}
        </Txt>
        {subtitle && !isEvent ? (
          <Txt tone="secondary" variant="caption">
            {subtitle}
          </Txt>
        ) : null}
        {sKey ? <Badge label={tr(sKey)} tone={item.status === 'unpaid' || item.status === 'hot' ? 'warning' : item.status === 'done' || item.status === 'paid' ? 'success' : 'neutral'} /> : null}
      </Card>

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('calendar.detail.when')} value={when} last={!item.amount && !(isEvent && (event?.location || event?.description))} />
        {item.amount ? <InfoRow label={tr('calendar.detail.amount')} value={fmt.money(item.amount, item.currency ?? 'TRY')} last={!isEvent} /> : null}
        {isEvent && event?.location ? (
          <InfoRow label={tr('calendar.event.location')} last={!event.description}>
            <Row gap={4} style={{ flexShrink: 1 }}>
              <MapPin size={14} color={t.colors.textSecondary} />
              <Txt variant="bodyStrong" style={{ flexShrink: 1 }} selectable>
                {event.location}
              </Txt>
            </Row>
          </InfoRow>
        ) : null}
        {isEvent && event?.description ? (
          <View style={{ paddingVertical: t.spacing.md, gap: 4 }}>
            <Txt variant="caption" tone="secondary">
              {tr('calendar.event.description')}
            </Txt>
            <Txt selectable>{event.description}</Txt>
          </View>
        ) : null}
      </Card>

      {item.movable ? (
        <Row gap={6}>
          <CalendarClock size={14} color={t.colors.textMuted} />
          <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
            {tr('mobile.calendar.long_press_hint')}
          </Txt>
        </Row>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        {href ? (
          <Button
            size="lg"
            label={tr('calendar.detail.open')}
            icon={<ArrowUpRight size={18} color={t.colors.onPrimary} />}
            onPress={() => {
              onClose();
              router.push(href);
            }}
          />
        ) : null}
        {isEvent && canWrite && event ? <Button size="lg" variant={href ? 'outline' : 'primary'} label={tr('mobile.calendar.edit')} icon={<Pencil size={16} color={href ? t.colors.text : t.colors.onPrimary} />} onPress={() => onEdit(item)} /> : null}
        {item.movable ? <Button variant="outline" label={tr('mobile.calendar.reschedule.title')} icon={<CalendarClock size={16} color={t.colors.text} />} onPress={() => onReschedule(item)} /> : null}
        {isEvent && canWrite && event ? (
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
    </Sheet>
  );
}
