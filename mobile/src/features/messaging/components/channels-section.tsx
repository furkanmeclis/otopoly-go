/**
 * "Kanallar" (web Settings → Mesajlar → Kanallar, `channels-panel.tsx`): WhatsApp, SMS – Netgsm, SMS – Twilio
 * and e-mail cards with their status. SMS providers are connected with the organization's own credentials
 * (stored encrypted server-side; only masked hints come back), one provider is the active SMS channel.
 * Writes are owner-only (backend: tenant.messaging.write + owner membership); others see the cards read-only.
 */
import { CheckCircle2, Lock, MessageSquareText, PlugZap, Settings2, Unplug, XCircle } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Switch, View, Platform } from 'react-native';

import { Badge, Button, Card, InfoRow, Row, Section, Skeleton, Txt, useConfirm, type Tone } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { useSmsChannel, useSmsMutations, useWhatsAppSession } from '../queries';
import type { SmsProviderCode, SmsProviderEntry, SmsTestResult } from '../services/sms.service';
import { EmailIcon, NetgsmIcon, TwilioIcon, WhatsAppIcon } from './channel-icons';
import { WarningNote } from './parts';
import { FIELD_KEYS, PROVIDER_KEYS, SENDER_KEYS, SmsProviderSheet, SmsTestSheet } from './sms-sheets';

const PROVIDER_ICONS: Record<SmsProviderCode, (p: { size?: number }) => ReactNode> = { netgsm: NetgsmIcon, twilio: TwilioIcon };

export function ChannelsSection({ canWrite }: { canWrite: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const sms = useSmsChannel();
  const [editing, setEditing] = useState<SmsProviderEntry | null>(null);
  const [testing, setTesting] = useState<SmsProviderCode | null>(null);
  const overview = sms.data;

  return (
    <Section title={tr('mobile.messaging.channels.section')}>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.messaging.channels.description')}
      </Txt>
      {!canWrite ? (
        <Row gap={6}>
          <Lock size={14} color={t.colors.textMuted} />
          <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
            {tr('mobile.messaging.channels.read_only')}
          </Txt>
        </Row>
      ) : null}
      <WhatsAppChannelCard />
      {sms.isLoading ? (
        <>
          <Skeleton height={150} radius={t.radius.lg} />
          <Skeleton height={150} radius={t.radius.lg} />
        </>
      ) : null}
      {sms.isError ? <WarningNote>{tr('mobile.messaging.channels.load_failed')}</WarningNote> : null}
      {overview?.providers.map((entry) => (
        <SmsProviderCard key={entry.provider} entry={entry} canWrite={canWrite} onEdit={() => setEditing(entry)} onTestSms={() => setTesting(entry.provider)} />
      ))}
      <EmailChannelCard />

      <SmsProviderSheet
        entry={editing}
        otherActive={Boolean(overview?.active_provider && editing && overview.active_provider !== editing.provider)}
        onClose={() => setEditing(null)}
      />
      <SmsTestSheet provider={testing} onClose={() => setTesting(null)} />
    </Section>
  );
}

function ChannelHeader({ icon, title, subtitle, badge }: { icon: ReactNode; title: string; subtitle: string; badge: { label: string; tone: Tone } }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
      <View style={{ width: 44, height: 44, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {subtitle}
        </Txt>
      </View>
      <Badge size="sm" tone={badge.tone} label={badge.label} />
    </View>
  );
}

function WhatsAppChannelCard() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const session = useWhatsAppSession().data;
  let badge: { label: string; tone: Tone } = { label: tr('mobile.messaging.channels.status.not_connected'), tone: 'neutral' };
  if (session?.own_number_entitled && session.status === 'connected') badge = { label: tr('mobile.messaging.channels.status.own_number'), tone: 'success' };
  else if (session?.platform_sender_available) badge = { label: tr('mobile.messaging.channels.status.platform'), tone: 'success' };
  else if (session?.status === 'qr_pending') badge = { label: tr('mobile.messaging.channels.status.pairing'), tone: 'warning' };
  return (
    <Card style={{ gap: t.spacing.md }}>
      <ChannelHeader icon={<WhatsAppIcon size={26} />} title={tr('mobile.messaging.channels.whatsapp.title')} subtitle={tr('mobile.messaging.channels.whatsapp.subtitle')} badge={badge} />
      <Txt variant="caption" tone="secondary">
        {tr('mobile.messaging.channels.whatsapp.description')}
      </Txt>
      {session?.phone_number && session.status === 'connected' ? (
        <Txt variant="mono" selectable>
          {session.phone_number}
        </Txt>
      ) : null}
    </Card>
  );
}

function EmailChannelCard() {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Card style={{ gap: t.spacing.md }}>
      <ChannelHeader
        icon={<EmailIcon size={26} />}
        title={tr('mobile.messaging.channels.email.title')}
        subtitle={tr('mobile.messaging.channels.email.subtitle')}
        badge={{ label: tr('mobile.messaging.channels.status.platform'), tone: 'success' }}
      />
      <Txt variant="caption" tone="secondary">
        {tr('mobile.messaging.channels.email.description')}
      </Txt>
    </Card>
  );
}

function SmsProviderCard({ entry, canWrite, onEdit, onTestSms }: { entry: SmsProviderEntry; canWrite: boolean; onEdit: () => void; onTestSms: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const { setActive, disconnect, test, reason } = useSmsMutations();
  const [result, setResult] = useState<SmsTestResult | null>(null);
  const account = entry.account;
  const Icon = PROVIDER_ICONS[entry.provider];
  const name = tr(PROVIDER_KEYS[entry.provider].name);

  let badge: { label: string; tone: Tone } = { label: tr('mobile.messaging.channels.status.not_connected'), tone: 'neutral' };
  if (account) {
    if (account.status === 'error') badge = { label: tr('mobile.messaging.channels.status.error'), tone: 'danger' };
    else if (account.is_active) badge = { label: tr('mobile.messaging.channels.status.active'), tone: 'success' };
    else badge = { label: tr('mobile.messaging.channels.status.inactive'), tone: 'warning' };
  }
  const hinted = account ? entry.fields.filter((f) => account.credential_hints?.[f.key]) : [];

  return (
    <Card style={{ gap: t.spacing.md }}>
      <ChannelHeader
        icon={<Icon size={26} />}
        title={tr('mobile.messaging.channels.sms.title', { provider: name })}
        subtitle={tr(PROVIDER_KEYS[entry.provider].subtitle)}
        badge={badge}
      />
      <Txt variant="caption" tone="secondary">
        {tr(PROVIDER_KEYS[entry.provider].description)}
      </Txt>

      {account ? (
        <View>
          <InfoRow label={tr(SENDER_KEYS[entry.sender_kind].label)} last={!hinted.length && !account.last_checked_at}>
            <Txt variant="mono" numberOfLines={1} style={{ flexShrink: 1 }} selectable>
              {account.sender}
            </Txt>
          </InfoRow>
          {hinted.map((f, i) => (
            <InfoRow key={f.key} label={FIELD_KEYS[f.key] ? tr(FIELD_KEYS[f.key].label) : f.key} last={i === hinted.length - 1 && !account.last_checked_at}>
              <Txt variant="mono" numberOfLines={1}>
                {account.credential_hints[f.key]}
              </Txt>
            </InfoRow>
          ))}
          {account.last_checked_at ? <InfoRow label={tr('mobile.messaging.sms.last_checked')} value={fmt.dateTime(account.last_checked_at)} last /> : null}
        </View>
      ) : null}

      {account?.status === 'error' && account.last_error ? <WarningNote>{account.last_error}</WarningNote> : null}

      {result ? <TestResultBox result={result} reason={reason} /> : null}

      {account ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">{tr('mobile.messaging.sms.use_as_channel')}</Txt>
            <Txt variant="caption" tone="secondary">
              {tr('mobile.messaging.sms.use_as_channel_hint')}
            </Txt>
          </View>
          <Switch
            value={account.is_active}
            disabled={!canWrite || setActive.isPending}
            onValueChange={(isActive) => setActive.mutate({ provider: entry.provider, isActive })}
            accessibilityLabel={`${tr('mobile.messaging.sms.use_as_channel')} · ${name}`}
            trackColor={{ true: t.colors.primary, false: t.colors.borderStrong }}
            thumbColor={Platform.OS === 'android' ? t.colors.surface : undefined}
          />
        </View>
      ) : null}

      {canWrite ? (
        <View style={{ gap: t.spacing.sm }}>
          <Button
            size="sm"
            variant={account ? 'outline' : 'primary'}
            label={account ? tr('mobile.messaging.sms.edit') : tr('mobile.messaging.sms.connect')}
            icon={account ? <Settings2 size={16} color={t.colors.text} /> : <PlugZap size={16} color={t.colors.onPrimary} />}
            onPress={onEdit}
          />
          {account ? (
            <>
              <Row gap={t.spacing.sm}>
                <View style={{ flex: 1 }}>
                  <Button
                    size="sm"
                    variant="outline"
                    label={tr('mobile.messaging.sms.test_connection')}
                    icon={<CheckCircle2 size={16} color={t.colors.text} />}
                    loading={test.isPending}
                    onPress={() => test.mutate(entry.provider, { onSuccess: setResult })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button size="sm" variant="outline" label={tr('mobile.messaging.sms.send_test')} icon={<MessageSquareText size={16} color={t.colors.text} />} onPress={onTestSms} />
                </View>
              </Row>
              <Button
                size="sm"
                variant="outline"
                label={tr('mobile.messaging.sms.disconnect.action')}
                icon={<Unplug size={16} color={t.colors.danger} />}
                loading={disconnect.isPending}
                onPress={async () => {
                  const ok = await confirm({
                    title: tr('mobile.messaging.sms.disconnect.title', { provider: name }),
                    message: tr('mobile.messaging.sms.disconnect.body'),
                    destructive: true,
                    confirmLabel: tr('mobile.messaging.sms.disconnect.confirm'),
                  });
                  if (ok) disconnect.mutate(entry.provider, { onSuccess: () => setResult(null) });
                }}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Result of "Bağlantıyı test et": balance / credits / approved headers, or the classified reason. */
function TestResultBox({ result, reason }: { result: SmsTestResult; reason: (code?: string, message?: string) => string }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const ok = result.ok;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ gap: t.spacing.xs, borderRadius: t.radius.md, padding: t.spacing.md, backgroundColor: ok ? t.colors.successBg : t.colors.dangerBg }}
    >
      <Row gap={t.spacing.sm}>
        {ok ? <CheckCircle2 size={16} color={t.colors.success} /> : <XCircle size={16} color={t.colors.danger} />}
        <Txt variant="bodyStrong" tone={ok ? 'success' : 'danger'}>
          {ok ? tr('mobile.messaging.sms.test.ok') : tr('mobile.messaging.sms.test.failed')}
        </Txt>
      </Row>
      {ok ? (
        <>
          {result.detail ? <Txt variant="caption">{result.detail}</Txt> : null}
          {result.balance ? (
            <Txt variant="caption">
              {`${tr('mobile.messaging.sms.test.balance')}: ${result.balance}${result.sms_credit != null ? ` · ${tr('mobile.messaging.sms.toast.sms_credit', { count: fmt.number(result.sms_credit, 0) })}` : ''}`}
            </Txt>
          ) : null}
          {result.senders?.length ? <Txt variant="caption">{`${tr('mobile.messaging.sms.test.senders')}: ${result.senders.join(', ')}`}</Txt> : null}
        </>
      ) : (
        <Txt variant="caption">{reason(result.error_code, result.message)}</Txt>
      )}
    </View>
  );
}
