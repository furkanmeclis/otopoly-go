import { CheckCircle2, MessageCircle, RefreshCw, Unplug, XCircle } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Badge, Button, Card, Dot, Row, Txt, useConfirm } from '@/components/ui';
import { QrCode } from '@/features/messaging/components/parts';
import { useConnectWhatsApp, useDisconnectWhatsApp, useWhatsAppSession } from '@/features/messaging/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const QR_TTL_SECONDS = 60;

/** WhatsApp session: connect → QR (polled until scanned) → connected / disconnect. */
export function WhatsAppSessionCard({ canWrite }: { canWrite: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const confirm = useConfirm();
  const session = useWhatsAppSession();
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const data = session.data;
  const status = data?.status ?? 'disconnected';
  const qrCode = data?.qr_code?.trim() || '';
  const qrExpiresAt = data?.qr_expires_at;
  const showQR = status === 'qr_pending' || (Boolean(qrCode) && status !== 'connected');
  const countdown = qrExpiresAt && status === 'qr_pending' ? Math.max(0, Math.floor((new Date(qrExpiresAt).getTime() - nowMs) / 1000)) : QR_TTL_SECONDS;

  useEffect(() => {
    if (!qrExpiresAt || status !== 'qr_pending') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [qrExpiresAt, status]);

  const onDisconnect = async () => {
    if (await confirm({ title: tr('messaging.wa.disconnect_title'), message: tr('messaging.wa.disconnect_body'), destructive: true, confirmLabel: tr('messaging.wa.disconnect'), cancelLabel: tr('messaging.wa.cancel') }))
      disconnect.mutate(undefined);
  };

  return (
    <Card style={{ gap: t.spacing.md }}>
      <Row gap={t.spacing.sm}>
        <MessageCircle size={20} color={t.colors.success} />
        <Txt variant="heading" style={{ flex: 1 }}>
          {tr('messaging.wa.title')}
        </Txt>
      </Row>
      <Txt variant="caption" tone="secondary">
        {tr('messaging.wa.description')}
      </Txt>

      {session.isLoading ? (
        <Row gap={t.spacing.sm}>
          <ActivityIndicator size="small" color={t.colors.textMuted} />
          <Txt variant="caption" tone="secondary">
            {tr('messaging.common.loading')}
          </Txt>
        </Row>
      ) : null}

      {!session.isLoading && (status === 'disconnected' || status === 'error') && !showQR ? (
        <View style={{ gap: t.spacing.md }}>
          {status === 'error' && data?.error_message ? (
            <Row gap={t.spacing.sm} style={{ backgroundColor: t.colors.dangerBg, borderRadius: t.radius.sm, padding: t.spacing.sm }}>
              <XCircle size={16} color={t.colors.danger} />
              <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
                {data.error_message}
              </Txt>
            </Row>
          ) : null}
          {canWrite ? (
            <Button label={tr('messaging.wa.connect')} icon={<MessageCircle size={18} color={t.colors.onPrimary} />} loading={connect.isPending} onPress={() => connect.mutate(undefined)} />
          ) : (
            <Txt variant="caption" tone="muted">
              {tr('mobile.settings.owner_only')}
            </Txt>
          )}
        </View>
      ) : null}

      {showQR ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={{ alignItems: 'center', gap: t.spacing.sm, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md, padding: t.spacing.lg }}>
            <Txt variant="caption" tone="secondary" style={{ alignSelf: 'stretch' }}>
              {tr('messaging.wa.scan')}
            </Txt>
            {qrCode ? <QrCode value={qrCode} size={232} label={tr('messaging.wa.qr_alt')} /> : <ActivityIndicator style={{ height: 232 }} color={t.colors.textMuted} />}
            <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {tr('mobile.settings.wa_scan_other_device')}
            </Txt>
          </View>
          <Row gap={t.spacing.md} style={{ justifyContent: 'space-between' }}>
            <Badge tone={countdown > 10 ? 'neutral' : 'danger'} label={countdown > 0 ? tr('messaging.wa.expires_in', { seconds: countdown }) : tr('messaging.wa.expired')} />
            {canWrite ? (
              <Button size="sm" variant="outline" label={tr('messaging.wa.refresh')} icon={<RefreshCw size={16} color={t.colors.text} />} loading={connect.isPending} onPress={() => connect.mutate(undefined)} />
            ) : null}
          </Row>
        </View>
      ) : null}

      {status === 'connected' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: t.spacing.md }}>
          <Dot color={t.colors.success} size={10} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {data?.display_name ? <Txt variant="bodyStrong">{data.display_name}</Txt> : null}
            {data?.phone_number ? (
              <Txt variant="caption" tone="secondary">
                {data.phone_number}
              </Txt>
            ) : null}
            {!data?.display_name && !data?.phone_number ? <Txt tone="secondary">{tr('messaging.wa.connected')}</Txt> : null}
          </View>
          <CheckCircle2 size={18} color={t.colors.success} />
        </View>
      ) : null}
      {status === 'connected' && canWrite ? (
        <Button variant="outline" label={tr('messaging.wa.disconnect')} icon={<Unplug size={16} color={t.colors.text} />} loading={disconnect.isPending} onPress={() => void onDisconnect()} />
      ) : null}
    </Card>
  );
}
