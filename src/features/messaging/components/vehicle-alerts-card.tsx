import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, Car, Send } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { Badge, Button, Card, Row, Segmented, SwitchRow, Txt } from '@/components/ui';
import { useCodeErrorMessage } from '@/features/messaging/components/daily-summary-card';
import { CheckRow, ProfileHint, RoleBadge, WarningNote } from '@/features/messaging/components/parts';
import { MessageChannelPicker } from '@/features/messaging/components/message-channel-picker';
import { messagingKeys, useVehicleAlerts } from '@/features/messaging/queries';
import type { MessageChannel } from '@/features/messaging/services/daily-summary.service';
import {
  VEHICLE_ALERT_BATCH_OPTIONS,
  VEHICLE_ALERT_EVENTS,
  vehicleAlertsService,
  type VehicleAlertEvent,
  type VehicleAlertInput,
  type VehicleAlertSettings,
} from '@/features/messaging/services/vehicle-alerts.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.messaging.vehicle_alerts');
const sameSet = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();
const toggleIn = <T extends string>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Team vehicle alerts — owner-only (web `VehicleAlertsCard`). */
export function VehicleAlertsCard() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const query = useVehicleAlerts(true);
  const data = query.data;
  if (!data)
    return (
      <Card style={{ gap: t.spacing.sm }}>
        <Title />
        <Txt variant="caption" tone={query.isError ? 'danger' : 'secondary'}>
          {query.isError ? tr('messaging.vehicle_alerts.errors.generic') : tr('common.loading')}
        </Txt>
      </Card>
    );
  const savedKey = [data.enabled, data.batch_minutes, data.channel, [...data.events].sort().join(','), [...data.service_uuids].sort().join(','), [...data.recipient_user_uuids].sort().join(',')].join('|');
  return <VehicleAlertsForm key={savedKey} data={data} />;
}

function Title() {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Row gap={t.spacing.sm}>
      <Car size={18} color={t.colors.text} />
      <Txt variant="heading" style={{ flex: 1 }}>
        {tr('messaging.vehicle_alerts.title')}
      </Txt>
    </Row>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Txt variant="bodyStrong">{title}</Txt>
      {children}
    </View>
  );
}

function VehicleAlertsForm({ data }: { data: VehicleAlertSettings }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useCodeErrorMessage('messaging.vehicle_alerts');
  const [enabled, setEnabled] = useState(data.enabled);
  const [events, setEvents] = useState<VehicleAlertEvent[]>(data.events);
  const [allServices, setAllServices] = useState(data.service_uuids.length === 0);
  const [services, setServices] = useState<string[]>(data.service_uuids);
  const [recipients, setRecipients] = useState<string[]>(data.recipient_user_uuids);
  const [batch, setBatch] = useState<number>(data.batch_minutes);
  const [channel, setChannel] = useState<MessageChannel>(data.channel ?? 'whatsapp');
  const channelReady = channel === 'sms' ? data.sms_available : data.whatsapp_connected;

  const effectiveServices = allServices ? [] : services;
  const dirty =
    data.enabled !== enabled ||
    data.batch_minutes !== batch ||
    (data.channel ?? 'whatsapp') !== channel ||
    !sameSet(data.events, events) ||
    !sameSet(data.service_uuids, effectiveServices) ||
    !sameSet(data.recipient_user_uuids, recipients);

  const onError = (err: unknown) => {
    log.warn('Vehicle alerts action failed', err);
    toast.error(errorMessage(err));
  };
  const save = useMutation({
    mutationFn: (body: VehicleAlertInput) => vehicleAlertsService.update(body),
    onSuccess: (res) => {
      qc.setQueryData(messagingKeys.vehicleAlerts, res);
      toast.success(tr('messaging.vehicle_alerts.saved'));
    },
    onError,
  });
  const sendTest = useMutation({
    mutationFn: vehicleAlertsService.sendTest,
    onSuccess: (res) => {
      toast.success(
        data.channel === 'sms'
          ? tr('mobile.messaging.vehicle_alerts.test_sent_sms', { in_app: res.in_app, sms: res.sms ?? 0 })
          : tr('messaging.vehicle_alerts.test_sent', { in_app: res.in_app, whatsapp: res.whatsapp }),
      );
      if (res.skipped.length > 0) toast.show('warning', tr('messaging.vehicle_alerts.test_skipped', { names: res.skipped.join(', ') }));
    },
    onError,
  });

  const needingPhone = data.members.filter((m) => recipients.includes(m.uuid) && !m.has_push && !m.has_phone);

  return (
    <Card style={{ gap: t.spacing.md }}>
      <Title />
      <Txt variant="caption" tone="secondary">
        {tr('messaging.vehicle_alerts.description')}
      </Txt>
      {!channelReady ? (
        <WarningNote>{channel === 'sms' ? tr('mobile.messaging.channel_picker.sms_not_ready') : tr('messaging.vehicle_alerts.not_connected')}</WarningNote>
      ) : null}
      <SwitchRow label={tr('messaging.vehicle_alerts.enabled')} value={enabled} onValueChange={setEnabled} />
      <MessageChannelPicker value={channel} onChange={setChannel} smsAvailable={data.sms_available} />

      <Fieldset title={tr('messaging.vehicle_alerts.events')}>
        <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, overflow: 'hidden' }}>
          {VEHICLE_ALERT_EVENTS.map((ev, i) => (
            <CheckRow key={ev} label={tr(`messaging.vehicle_alerts.event.${ev}`)} checked={events.includes(ev)} onToggle={() => setEvents((p) => toggleIn(p, ev))} last={i === VEHICLE_ALERT_EVENTS.length - 1} />
          ))}
        </View>
      </Fieldset>

      <Fieldset title={tr('messaging.vehicle_alerts.frequency')}>
        <Segmented<string>
          value={String(batch)}
          onChange={(v) => setBatch(Number(v))}
          options={VEHICLE_ALERT_BATCH_OPTIONS.map((opt) => ({ value: String(opt), label: tr(`messaging.vehicle_alerts.batch.${opt}`) }))}
        />
        <Txt variant="caption" tone="secondary">
          {tr('messaging.vehicle_alerts.frequency_hint')}
        </Txt>
      </Fieldset>

      <Fieldset title={tr('messaging.vehicle_alerts.services')}>
        <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, overflow: 'hidden' }}>
          <CheckRow label={tr('messaging.vehicle_alerts.all_services')} checked={allServices} onToggle={() => setAllServices((v) => !v)} last={allServices} />
          {!allServices
            ? data.services.map((sv, i) => <CheckRow key={sv.uuid} label={sv.name} checked={services.includes(sv.uuid)} onToggle={() => setServices((p) => toggleIn(p, sv.uuid))} last={i === data.services.length - 1} />)
            : null}
          {!allServices && data.services.length === 0 ? (
            <Txt variant="caption" tone="secondary" style={{ padding: t.spacing.md }}>
              {tr('messaging.vehicle_alerts.no_services')}
            </Txt>
          ) : null}
        </View>
      </Fieldset>

      <Fieldset title={tr('messaging.vehicle_alerts.recipients')}>
        <Txt variant="caption" tone="secondary">
          {tr('messaging.vehicle_alerts.recipients_hint')}
        </Txt>
        <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, overflow: 'hidden', marginTop: 4 }}>
          {data.members.map((m, i) => (
            <CheckRow
              key={m.uuid}
              label={m.name || m.email}
              description={m.email}
              checked={recipients.includes(m.uuid)}
              onToggle={() => setRecipients((p) => toggleIn(p, m.uuid))}
              last={i === data.members.length - 1}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <RoleBadge owner={m.role === 'owner'} ownerLabel={tr('messaging.vehicle_alerts.role_owner')} staffLabel={tr('messaging.vehicle_alerts.role_staff')} />
                  <Badge
                    size="sm"
                    tone={!m.has_push && !m.has_phone ? 'warning' : 'neutral'}
                    icon={m.has_push ? <BellRing size={11} color={t.colors.neutral} /> : undefined}
                    label={
                      m.has_push
                        ? tr('messaging.vehicle_alerts.via_push')
                        : m.has_phone
                          ? channel === 'sms'
                            ? tr('mobile.messaging.channel_picker.sms')
                            : tr('messaging.vehicle_alerts.via_whatsapp')
                          : tr('messaging.vehicle_alerts.via_inapp_only')
                    }
                  />
                </View>
              }
            />
          ))}
        </View>
        {needingPhone.length > 0 ? (
          <ProfileHint text={tr('messaging.vehicle_alerts.no_channel_hint', { names: needingPhone.map((m) => m.name || m.email).join(', ') })} link={tr('messaging.vehicle_alerts.no_channel_link')} />
        ) : null}
      </Fieldset>

      <View style={{ gap: t.spacing.sm }}>
        <Button
          label={tr('common.save')}
          loading={save.isPending}
          disabled={!dirty}
          onPress={() => save.mutate({ enabled, events, service_uuids: effectiveServices, recipient_user_uuids: recipients, batch_minutes: batch, channel })}
        />
        <Button
          variant="outline"
          size="sm"
          label={tr('messaging.vehicle_alerts.send_test')}
          icon={<Send size={16} color={t.colors.text} />}
          loading={sendTest.isPending}
          disabled={dirty || data.recipient_user_uuids.length === 0}
          onPress={() => sendTest.mutate()}
        />
        {dirty ? (
          <Txt variant="caption" tone="muted">
            {tr('messaging.vehicle_alerts.save_first')}
          </Txt>
        ) : null}
      </View>
    </Card>
  );
}
