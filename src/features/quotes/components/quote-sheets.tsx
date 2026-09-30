/** Quote dialogs as bottom sheets: send, convert to job, decision, reminders (web send-/convert-quote-dialog, quote-detail-page). */
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { AlertTriangle, ArrowRight, Check, CircleSlash, Copy, Download, MessageCircle, Send } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { useApiErrorMessage, useToast } from '@/components/feedback/toast';
import { Button, Card, DateField, Group, InfoRow, ListRow, PlateBadge, Row, SelectField, Sheet, Skeleton, SwitchRow, TextField, Txt } from '@/components/ui';
import { VehicleModelPicker } from '@/features/customers/components/pickers';
import { Notice } from '@/features/leads/components/crm-ui';
import { localToday } from '@/features/jobs/lib/job-ui';
import { useQuoteConvertPreview } from '@/features/queries';
import { deliveryErrorText, isWhatsAppNotConnected } from '@/features/quotes/lib/quote-ui';
import { useQuoteMutations, useQuoteSendPreview } from '@/features/quotes/queries';
import { quotesService } from '@/features/quotes/services/quotes.service';
import type { QuoteDelivery, QuoteDetail, QuoteReminderInput, ReminderKind } from '@/features/quotes/types';
import { createLogger } from '@/lib/logger';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.quote-sheets');
const PRESETS: ReminderKind[] = ['before_3d', 'before_1d', 'last_day'];

/** Copy the public share link (web `copyShareLink`). */
export function useCopyShareLink() {
  const toast = useToast();
  const { t } = useLocale();
  return async (url: string) => {
    await Clipboard.setStringAsync(url);
    toast.success(t('quotes.toast.link_copied'));
  };
}

/** PDF download + share sheet; errors toast. */
export function useQuotePdf() {
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const share = async (q: Pick<QuoteDetail, 'uuid' | 'number'>) => {
    setBusy(true);
    try {
      await quotesService.downloadPdf(q.uuid, q.number);
    } catch (error) {
      log.error('Quote PDF failed', { uuid: q.uuid, error });
      toast.error(t('common.error_generic'), toMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, share };
}

export function remindersBody(kinds: ReminderKind[], customDate: string): QuoteReminderInput[] {
  return kinds.filter((k) => k !== 'custom' || customDate).map((k) => (k === 'custom' ? { kind: k, date: customDate } : { kind: k }));
}

export function QuoteReminderPicker({ quote, kinds, onKinds, customDate, onCustomDate }: { quote: QuoteDetail; kinds: ReminderKind[]; onKinds: (k: ReminderKind[]) => void; customDate: string; onCustomDate: (d: string) => void }) {
  const { t: tr } = useLocale();
  const hasValid = Boolean(quote.valid_until);
  const toggle = (k: ReminderKind, on: boolean) => onKinds(on ? [...kinds, k] : kinds.filter((x) => x !== k));
  return (
    <View style={{ gap: 4 }}>
      {!hasValid ? (
        <Txt variant="caption" tone="muted">
          {tr('quotes.reminders.need_valid_until')}
        </Txt>
      ) : null}
      {PRESETS.map((k) => (
        <SwitchRow key={k} label={tr(`quotes.reminders.kind.${k}`)} value={kinds.includes(k)} disabled={!hasValid} onValueChange={(v) => toggle(k, v)} />
      ))}
      <SwitchRow label={tr('quotes.reminders.kind.custom')} value={kinds.includes('custom')} onValueChange={(v) => toggle('custom', v)} />
      {kinds.includes('custom') ? <DateField label={tr('quotes.reminders.kind.custom')} value={customDate || null} onChange={(v) => onCustomDate(v ?? '')} /> : null}
    </View>
  );
}

function WhatsAppNotConnected() {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Notice tone="warning" icon={<AlertTriangle size={18} color={t.colors.warning} />} title={tr('quotes.send.wa_not_connected')}>
      <Txt variant="caption" tone="secondary">
        {tr('quotes.send.wa_not_connected_hint')}
      </Txt>
      <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push('/settings/messaging' as never)}>
        {tr('quotes.send.wa_settings_link')}
      </Txt>
    </Notice>
  );
}

// ─── Send ──────────────────────────────────────────────────────────────────

export function SendQuoteSheet({ quote, visible, onClose }: { quote: QuoteDetail; visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('quotes.send.title', { number: quote.number })}>
      <SendBody key={visible ? 'open' : 'closed'} quote={quote} visible={visible} onClose={onClose} />
    </Sheet>
  );
}

function SendBody({ quote, visible, onClose }: { quote: QuoteDetail; visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { send } = useQuoteMutations();
  const copy = useCopyShareLink();
  const pdf = useQuotePdf();
  const [kinds, setKinds] = useState<ReminderKind[]>(() => (quote.valid_until ? ['before_1d'] : []));
  const [customDate, setCustomDate] = useState(localToday);
  const [result, setResult] = useState<QuoteDelivery | null>(null);
  const noPhone = !quote.customer_phone;
  const preview = useQuoteSendPreview(quote.uuid, visible);
  const waDisconnected = preview.data !== undefined && !preview.data.channel_connected;

  const submit = () =>
    send.mutate(
      { uuid: quote.uuid, body: { channel: 'whatsapp', reminders: kinds.length > 0 ? remindersBody(kinds, customDate) : undefined } },
      { onSuccess: (res) => (res.delivery.status === 'sent' ? onClose() : setResult(res.delivery)) },
    );

  if (result) {
    const waText = tr('quotes.send.wa_text', { name: quote.customer_name, number: quote.number, total: fmt.money(quote.grand_total, quote.currency), link: quote.share_url });
    return (
      <>
        <Notice tone="danger" icon={<AlertTriangle size={18} color={t.colors.danger} />} title={tr('quotes.send.failed')}>
          {deliveryErrorText(result.error, tr)}
        </Notice>
        {isWhatsAppNotConnected(result.error) ? <WhatsAppNotConnected /> : null}
        <Txt tone="secondary">{tr('quotes.send.fallback')}</Txt>
        <Button variant="outline" label={tr('quotes.actions.copy_link')} icon={<Copy size={16} color={t.colors.text} />} onPress={() => copy(quote.share_url)} />
        <Button variant="outline" label={tr('quotes.actions.pdf')} icon={<Download size={16} color={t.colors.text} />} loading={pdf.busy} onPress={() => pdf.share(quote)} />
        {quote.customer_phone ? (
          <Button
            variant="outline"
            label={tr('quotes.send.open_whatsapp')}
            icon={<MessageCircle size={16} color={t.colors.text} />}
            onPress={() => Linking.openURL(`https://wa.me/${quote.customer_phone.replace(/\D/g, '').replace(/^0/, '90')}?text=${encodeURIComponent(waText)}`)}
          />
        ) : null}
        <Button label={tr('common.close')} icon={<Check size={16} color={t.colors.onPrimary} />} onPress={onClose} />
      </>
    );
  }

  return (
    <>
      <Txt tone="secondary">{tr('quotes.send.description')}</Txt>
      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('quotes.fields.customer')} value={quote.customer_name} />
        <InfoRow label={tr('quotes.send.recipient')} value={quote.customer_phone || '—'} />
        <InfoRow label={tr('quotes.fields.grand_total')} value={fmt.money(quote.grand_total, quote.currency)} />
        <InfoRow label={tr('quotes.fields.valid_until')} value={quote.valid_until ? fmt.date(`${quote.valid_until}T12:00:00`) : '—'} last />
      </Card>
      {noPhone ? (
        <Notice tone="warning" icon={<AlertTriangle size={18} color={t.colors.warning} />}>
          {tr('quotes.send.no_phone')}
        </Notice>
      ) : waDisconnected ? (
        <WhatsAppNotConnected />
      ) : null}
      {preview.data?.message && !waDisconnected && !noPhone ? (
        <Card style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
            {tr('quotes.send.preview')}
          </Txt>
          <Txt variant="caption">{preview.data.message}</Txt>
          {preview.data.attachment_file_name ? (
            <Txt variant="caption" tone="muted">
              {preview.data.attachment_file_name}
            </Txt>
          ) : null}
        </Card>
      ) : null}
      <View style={{ gap: t.spacing.sm }}>
        <Txt variant="bodyStrong">{tr('quotes.reminders.title')}</Txt>
        <QuoteReminderPicker quote={quote} kinds={kinds} onKinds={setKinds} customDate={customDate} onCustomDate={setCustomDate} />
      </View>
      <Button size="lg" label={send.isPending ? tr('quotes.send.sending') : tr('quotes.send.submit')} icon={<Send size={18} color={t.colors.onPrimary} />} loading={send.isPending} onPress={submit} />
    </>
  );
}

// ─── Convert ───────────────────────────────────────────────────────────────

const NEW = '__new__';

export function ConvertQuoteSheet({ quote, visible, onClose }: { quote: QuoteDetail; visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('quotes.convert.title')}>
      {visible ? <ConvertBody quote={quote} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ConvertBody({ quote, onClose }: { quote: QuoteDetail; onClose: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const preview = useQuoteConvertPreview(quote.uuid, true);
  const { convert } = useQuoteMutations();
  const [vehicleChoice, setVehicleChoice] = useState('');
  const [plate, setPlate] = useState(quote.vehicle_plate);
  const [catalog, setCatalog] = useState<string | null>(null);
  const p = preview.data;
  const money = (v: string) => fmt.money(v, p?.currency ?? quote.currency);
  const needsVehicle = Boolean(p && !p.vehicle_uuid && p.missing.length > 0);
  // Default to the customer's first saved vehicle: fewer taps.
  const choice = vehicleChoice || (p?.customer_vehicles[0]?.uuid ?? NEW);
  const picking = needsVehicle && choice !== NEW;
  const needPlate = needsVehicle && !picking && Boolean(p?.missing.includes('plate'));
  const needModel = needsVehicle && !picking && Boolean(p?.missing.includes('model'));
  const ready = Boolean(p?.can_convert) && (!needsVehicle || picking || ((!needPlate || plate.trim().length > 0) && (!needModel || Boolean(catalog))));
  const errs = fieldErrors(convert.error);

  const submit = () => {
    const [modelUuid, year] = catalog ? catalog.split(':') : [];
    convert.mutate(
      { uuid: quote.uuid, body: picking ? { vehicle_uuid: choice } : { plate: plate.trim() || undefined, model_uuid: modelUuid || null, year: year ? Number(year) : null } },
      {
        onSuccess: (res) => {
          onClose();
          router.push(`/jobs/${res.job_uuid}`);
        },
      },
    );
  };

  if (preview.isLoading || !p) {
    return (
      <View style={{ gap: t.spacing.md }}>
        <Skeleton height={48} />
        <Skeleton height={140} />
      </View>
    );
  }
  if (!p.can_convert) return <Notice tone="danger">{tr(`quotes.convert.blocker.${p.blocker ?? 'status'}`)}</Notice>;

  return (
    <>
      <Txt tone="secondary">{tr('quotes.convert.description')}</Txt>
      {p.will_accept ? (
        <Notice tone="success" icon={<Check size={18} color={t.colors.success} />}>
          {tr('quotes.convert.will_accept')}
        </Notice>
      ) : null}
      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('quotes.fields.customer')} value={p.customer_name} />
        <InfoRow label={tr('quotes.fields.vehicle')} last>
          {p.vehicle_uuid ? (
            <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 1 }}>
              <PlateBadge plate={p.plate} size="sm" />
              <Txt variant="caption" tone="muted">
                {p.vehicle_label}
              </Txt>
            </View>
          ) : p.creates_vehicle && p.plate ? (
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <PlateBadge plate={p.plate} size="sm" />
              <Txt variant="caption" tone="muted">
                {tr('quotes.convert.creates_vehicle')}
              </Txt>
            </View>
          ) : (
            <Txt tone="warning" variant="bodyStrong">
              {tr('quotes.convert.vehicle_missing')}
            </Txt>
          )}
        </InfoRow>
      </Card>

      {needsVehicle ? (
        <Card style={{ gap: t.spacing.md, borderColor: t.colors.warning }}>
          <Row gap={6}>
            <AlertTriangle size={16} color={t.colors.warning} />
            <Txt variant="caption" tone="warning" style={{ fontWeight: '700', flex: 1 }}>
              {tr('quotes.convert.vehicle_needed')}
            </Txt>
          </Row>
          {p.customer_vehicles.length > 0 ? (
            <SelectField
              label={tr('quotes.fields.vehicle')}
              value={choice}
              onChange={(v) => setVehicleChoice(v ?? NEW)}
              options={[{ value: NEW, label: tr('quotes.convert.new_vehicle') }, ...p.customer_vehicles.map((v) => ({ value: v.uuid, label: v.label }))]}
            />
          ) : null}
          {needPlate ? (
            <TextField label={tr('quotes.convert.plate')} value={plate} onChangeText={(v) => setPlate(v.toLocaleUpperCase('tr-TR'))} maxLength={16} autoCapitalize="characters" autoCorrect={false} error={errs.plate} required />
          ) : null}
          {needModel ? <VehicleModelPicker label={tr('quotes.convert.model')} value={catalog} onChange={(v) => setCatalog(v)} error={errs.model_uuid} /> : null}
        </Card>
      ) : null}

      <Group>
        {p.lines.map((l, i) => (
          <ListRow
            key={i}
            title={l.description}
            subtitle={l.included ? `${l.quantity} × ${money(l.unit_price)}` : tr(`quotes.convert.reason.${l.reason ?? 'not_a_service'}`)}
            left={l.included ? <Check size={18} color={t.colors.success} /> : <CircleSlash size={18} color={t.colors.textMuted} />}
            right={
              <Txt variant="mono" tone={l.included ? 'default' : 'muted'} style={l.included ? undefined : { textDecorationLine: 'line-through' }}>
                {money(l.line_total)}
              </Txt>
            }
            chevron={false}
            last={i === p.lines.length - 1}
          />
        ))}
      </Group>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="bodyStrong">{tr('quotes.convert.job_total')}</Txt>
        <Txt variant="title" tone="primary">
          {money(p.job_total)}
        </Txt>
      </Row>
      {p.skipped_total !== '0.00' ? (
        <Txt variant="caption" tone="muted">
          {tr('quotes.convert.skipped_note', { amount: money(p.skipped_total) })}
        </Txt>
      ) : null}
      <Button size="lg" label={convert.isPending ? tr('common.saving') : tr('quotes.convert.submit')} icon={<ArrowRight size={18} color={t.colors.onPrimary} />} loading={convert.isPending} disabled={!ready} onPress={submit} />
    </>
  );
}

// ─── Decision (accept / reject / cancel with note) ─────────────────────────

export type Decision = 'accepted' | 'rejected' | 'cancelled';

export function DecisionSheet({ status, onClose, onConfirm, pending }: { status: Decision | null; onClose: () => void; onConfirm: (status: Decision, note: string) => void; pending: boolean }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={status !== null} onClose={onClose} title={status ? tr(`quotes.decision.${status}`) : ''}>
      {status ? <DecisionBody status={status} onConfirm={onConfirm} pending={pending} /> : null}
    </Sheet>
  );
}

function DecisionBody({ status, onConfirm, pending }: { status: Decision; onConfirm: (status: Decision, note: string) => void; pending: boolean }) {
  const { t: tr } = useLocale();
  const [note, setNote] = useState('');
  return (
    <>
      <TextField label={tr('quotes.decision.note')} value={note} onChangeText={setNote} multiline maxLength={1000} />
      <Button size="lg" variant={status === 'accepted' ? 'success' : 'danger'} label={tr('common.confirm')} loading={pending} onPress={() => onConfirm(status, note.trim())} />
    </>
  );
}

// ─── Reminders ─────────────────────────────────────────────────────────────

export function RemindersSheet({ quote, visible, onClose }: { quote: QuoteDetail; visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('quotes.reminders.title')}>
      <RemindersBody key={visible ? 'open' : 'closed'} quote={quote} onClose={onClose} />
    </Sheet>
  );
}

function RemindersBody({ quote, onClose }: { quote: QuoteDetail; onClose: () => void }) {
  const { t: tr } = useLocale();
  const { setReminders } = useQuoteMutations();
  const openReminders = quote.reminders.filter((r) => r.status === 'pending' || r.status === 'scheduled');
  const [kinds, setKinds] = useState<ReminderKind[]>(() => openReminders.map((r) => r.kind));
  const [customDate, setCustomDate] = useState(() => openReminders.find((r) => r.kind === 'custom')?.fire_at.slice(0, 10) ?? localToday());
  return (
    <>
      <QuoteReminderPicker quote={quote} kinds={kinds} onKinds={setKinds} customDate={customDate} onCustomDate={setCustomDate} />
      <Button size="lg" label={tr('common.save')} loading={setReminders.isPending} onPress={() => setReminders.mutate({ uuid: quote.uuid, reminders: remindersBody(kinds, customDate) }, { onSuccess: onClose })} />
    </>
  );
}
