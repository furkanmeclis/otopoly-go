import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Eye, Send } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { View } from 'react-native';

import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Button, Card, DateField, Row, Sheet, SwitchRow, Txt } from '@/components/ui';
import { MessageChannelPicker } from '@/features/messaging/components/message-channel-picker';
import { CheckRow, ProfileHint, RoleBadge, WarningNote } from '@/features/messaging/components/parts';
import { messagingKeys, useDailySummary } from '@/features/messaging/queries';
import { dailySummaryService, type DailySummaryInput, type DailySummarySettings, type MessageChannel } from '@/features/messaging/services/daily-summary.service';
import { hasTranslation } from '@/lib/i18n/translate';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.messaging.daily_summary');

/** Maps API error codes to `<prefix>.errors.<CODE>` like the web cards. */
export function useCodeErrorMessage(prefix: string) {
  const { t, locale } = useLocale();
  return (err: unknown) => {
    if (isApiError(err)) {
      const key = `${prefix}.errors.${err.code}`;
      return hasTranslation(locale, key) ? t(key) : err.message;
    }
    return t(`${prefix}.errors.generic`);
  };
}

/** End-of-day WhatsApp summary — owner-only (contains revenue and cash balances). */
export function DailySummaryCard() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const query = useDailySummary(true);
  const data = query.data;
  if (!data)
    return (
      <Card style={{ gap: t.spacing.sm }}>
        <Title />
        <Txt variant="caption" tone={query.isError ? 'danger' : 'secondary'}>
          {query.isError ? tr('messaging.daily_summary.errors.generic') : tr('common.loading')}
        </Txt>
      </Card>
    );
  // Re-mount the form whenever the saved settings change so its local state starts from the server values.
  const savedKey = [data.enabled, data.send_time, data.channel, [...data.recipient_user_uuids].sort().join(',')].join('|');
  return <DailySummaryForm key={savedKey} data={data} />;
}

function Title() {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Row gap={t.spacing.sm}>
      <CalendarClock size={18} color={t.colors.text} />
      <Txt variant="heading" style={{ flex: 1 }}>
        {tr('messaging.daily_summary.title')}
      </Txt>
    </Row>
  );
}

function DailySummaryForm({ data }: { data: DailySummarySettings }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useCodeErrorMessage('messaging.daily_summary');
  const [enabled, setEnabled] = useState(data.enabled);
  const [sendTime, setSendTime] = useState(data.send_time);
  const [recipients, setRecipients] = useState<string[]>(data.recipient_user_uuids);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [channel, setChannel] = useState<MessageChannel>(data.channel ?? 'whatsapp');
  const channelReady = channel === 'sms' ? data.sms_available : data.whatsapp_connected;

  const onError = (err: unknown) => {
    log.warn('Daily summary action failed', err);
    toast.error(errorMessage(err));
  };
  const save = useMutation({
    mutationFn: (body: DailySummaryInput) => dailySummaryService.update(body),
    onSuccess: (res) => {
      qc.setQueryData(messagingKeys.dailySummary, res);
      toast.success(tr('messaging.daily_summary.saved'));
    },
    onError,
  });
  const preview = useMutation({ mutationFn: dailySummaryService.preview, onSuccess: (res) => setPreviewText(res.message), onError });
  const sendTest = useMutation({
    mutationFn: dailySummaryService.sendTest,
    onSuccess: (res) => {
      toast.success(tr('messaging.daily_summary.test_sent', { count: res.sent }));
      if (res.skipped.length > 0) toast.show('warning', tr('messaging.daily_summary.test_skipped', { names: res.skipped.join(', ') }));
    },
    onError,
  });

  const dirty = data.enabled !== enabled || data.send_time !== sendTime || (data.channel ?? 'whatsapp') !== channel || [...data.recipient_user_uuids].sort().join() !== [...recipients].sort().join();
  const selectedWithoutPhone = data.members.filter((m) => recipients.includes(m.uuid) && !m.has_phone);

  return (
    <Card style={{ gap: t.spacing.md }}>
      <Title />
      <Txt variant="caption" tone="secondary">
        {tr('messaging.daily_summary.description')}
      </Txt>
      {!channelReady ? (
        <WarningNote>{channel === 'sms' ? tr('mobile.messaging.channel_picker.sms_not_ready') : tr('messaging.daily_summary.not_connected')}</WarningNote>
      ) : null}
      <MessageChannelPicker value={channel} onChange={setChannel} smsAvailable={data.sms_available} />

      <SwitchRow
        label={tr('messaging.daily_summary.enabled')}
        description={data.last_sent_on ? tr('messaging.daily_summary.last_sent', { date: fmt.date(data.last_sent_on, 'short') }) : tr('messaging.daily_summary.never_sent')}
        value={enabled}
        onValueChange={setEnabled}
      />
      <View style={{ gap: 4 }}>
        <DateField mode="time" label={tr('messaging.daily_summary.send_time')} value={sendTime} onChange={(v) => v && setSendTime(v.slice(0, 5))} />
        <Txt variant="caption" tone="secondary">
          {tr('messaging.daily_summary.send_time_hint')}
        </Txt>
      </View>

      <View style={{ gap: t.spacing.xs }}>
        <Txt variant="bodyStrong">{tr('messaging.daily_summary.recipients')}</Txt>
        <Txt variant="caption" tone="secondary">
          {tr('messaging.daily_summary.recipients_hint')}
        </Txt>
      </View>
      <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, overflow: 'hidden' }}>
        {data.members.map((m, i) => (
          <CheckRow
            key={m.uuid}
            label={m.name || m.email}
            description={m.email}
            checked={recipients.includes(m.uuid)}
            onToggle={() => setRecipients((prev) => (prev.includes(m.uuid) ? prev.filter((id) => id !== m.uuid) : [...prev, m.uuid]))}
            last={i === data.members.length - 1}
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <RoleBadge owner={m.role === 'owner'} ownerLabel={tr('messaging.daily_summary.role_owner')} staffLabel={tr('messaging.daily_summary.role_staff')} />
                {!m.has_phone ? <BadgeWarn label={tr('messaging.daily_summary.no_phone')} /> : null}
              </View>
            }
          />
        ))}
      </View>
      {selectedWithoutPhone.length > 0 ? (
        <ProfileHint text={tr('messaging.daily_summary.no_phone_hint', { names: selectedWithoutPhone.map((m) => m.name || m.email).join(', ') })} link={tr('messaging.daily_summary.no_phone_link')} />
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <Button label={tr('common.save')} loading={save.isPending} disabled={!dirty} onPress={() => save.mutate({ enabled, send_time: sendTime, recipient_user_uuids: recipients, channel })} />
        <Row gap={t.spacing.sm}>
          <View style={{ flex: 1 }}>
            <Button variant="outline" size="sm" label={tr('messaging.daily_summary.preview')} icon={<Eye size={16} color={t.colors.text} />} loading={preview.isPending} onPress={() => preview.mutate()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="outline"
              size="sm"
              label={tr('messaging.daily_summary.send_test')}
              icon={<Send size={16} color={t.colors.text} />}
              loading={sendTest.isPending}
              disabled={dirty || data.recipient_user_uuids.length === 0}
              onPress={() => sendTest.mutate()}
            />
          </View>
        </Row>
        {dirty ? (
          <Txt variant="caption" tone="muted">
            {tr('messaging.daily_summary.save_first')}
          </Txt>
        ) : null}
      </View>

      <Sheet visible={previewText !== null} onClose={() => setPreviewText(null)} title={tr('messaging.daily_summary.preview_title')}>
        <Txt variant="caption" tone="secondary">
          {tr('messaging.daily_summary.preview_hint')}
        </Txt>
        <View style={{ backgroundColor: t.colors.successBg, borderRadius: t.radius.lg, padding: t.spacing.md }}>
          <WhatsAppText text={previewText ?? ''} />
        </View>
      </Sheet>
    </Card>
  );
}

function BadgeWarn({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.warning, borderRadius: t.radius.full, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Txt variant="caption" tone="warning" style={{ fontSize: 11 }}>
        {label}
      </Txt>
    </View>
  );
}

/** Minimal WhatsApp markup: *bold* and _italic_. */
export function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <Txt selectable>
      {parts.map((part, i) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
          return (
            <Txt key={i} style={{ fontWeight: '700' }}>
              {part.slice(1, -1)}
            </Txt>
          );
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2)
          return (
            <Txt key={i} style={{ fontStyle: 'italic' }}>
              {part.slice(1, -1)}
            </Txt>
          );
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </Txt>
  );
}
