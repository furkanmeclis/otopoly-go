import { useMutation, useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, CircleX, Clock, LogIn, Monitor, ShieldAlert, Smartphone, TabletSmartphone } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { isApiError } from '@/api/errors';
import { Button, Card, EmptyState, ErrorState, Header, InfoRow, Row, Screen, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { clientLabel, isQRSessionId, locationLabel } from '@/features/qr-login/lib';
import { QR_ERRORS, qrLoginService } from '@/features/qr-login/qr-login.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';

const log = createLogger('screen.qr-login');

type Outcome = 'approved' | 'rejected';

/** Leaves the screen: back to the scanner/menu, or home when opened from a universal link. */
function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * `/login/qr/{id}` — opened by the in-app scanner or the universal link `https://otopoly.app/login/qr/{id}`.
 * Shows which browser / where the web sign-in request comes from, then Approve or Reject.
 * Lives outside the protected `(app)` group so a signed-out user gets an explanation instead of a dead end.
 */
export default function QRLoginApproveScreen() {
  useMarkInteractive();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = String(id ?? '');
  const { status } = useAuth();
  const { t: tr } = useLocale();
  const t = useTheme();

  const header = <Header title={tr('mobile.qr.approve_title')} onBack={close} />;

  if (status !== 'ready') {
    const signedOut = status === 'signedOut';
    return (
      <Screen header={header}>
        <EmptyState
          icon={<LogIn size={28} color={t.colors.textMuted} />}
          title={signedOut ? tr('mobile.qr.sign_in_first_title') : tr('mobile.qr.select_org_first_title')}
          description={signedOut ? tr('mobile.qr.sign_in_first') : tr('mobile.qr.select_org_first')}
          action={<Button label={signedOut ? tr('mobile.qr.go_sign_in') : tr('mobile.qr.go_select_org')} onPress={() => router.replace(signedOut ? '/login' : '/select-org')} />}
        />
      </Screen>
    );
  }
  if (!isQRSessionId(sessionId)) {
    return (
      <Screen header={header}>
        <ResultState kind="invalid" />
      </Screen>
    );
  }
  return <Approval sessionId={sessionId} header={header} />;
}

function Approval({ sessionId, header }: { sessionId: string; header: ReactNode }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { me, organization } = useAuth();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const details = useQuery({
    queryKey: ['qr-login', sessionId],
    queryFn: () => qrLoginService.get(sessionId),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const answer = useMutation({
    mutationKey: ['qr-login.answer', sessionId],
    mutationFn: async (decision: Outcome): Promise<{ status: Outcome }> => (decision === 'approved' ? qrLoginService.approve(sessionId) : qrLoginService.reject(sessionId)),
    onSuccess: (_data, decision) => {
      log.info('QR sign-in answered', { decision });
      setOutcome(decision);
      Haptics.notificationAsync(decision === 'approved' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    },
    onError: (error) => log.warn('QR sign-in answer failed', isApiError(error) ? error.code : error),
  });

  const remaining = useRemainingSeconds(details.data?.expires_at);

  if (outcome) {
    return (
      <Screen header={header} footer={<Button size="lg" label={tr('mobile.qr.done')} onPress={close} />}>
        <ResultState kind={outcome} />
      </Screen>
    );
  }

  const error = answer.error ?? details.error;
  if (error) {
    const code = isApiError(error) ? error.code : null;
    const kind: ResultKind | null =
      code === QR_ERRORS.notFound
        ? 'expired'
        : code === QR_ERRORS.claimed
          ? 'claimed'
          : code === QR_ERRORS.resolved
            ? 'resolved'
            : code === QR_ERRORS.deactivated
              ? 'deactivated'
              : null;
    return (
      <Screen header={header} footer={kind ? <Button size="lg" variant="outline" label={tr('mobile.qr.done')} onPress={close} /> : undefined}>
        {kind ? (
          <ResultState kind={kind} />
        ) : (
          <ErrorState
            onRetry={() => {
              answer.reset();
              details.refetch();
            }}
          />
        )}
      </Screen>
    );
  }

  const d = details.data;
  if (!d) {
    return (
      <Screen header={header}>
        <View style={{ paddingVertical: t.spacing.xxxl, alignItems: 'center' }}>
          <ActivityIndicator color={t.colors.primary} />
        </View>
      </Screen>
    );
  }

  if (d.status !== 'pending') {
    return (
      <Screen header={header} footer={<Button size="lg" variant="outline" label={tr('mobile.qr.done')} onPress={close} />}>
        <ResultState kind="resolved" />
      </Screen>
    );
  }

  const expired = remaining !== null && remaining <= 0;
  if (expired) {
    return (
      <Screen header={header} footer={<Button size="lg" variant="outline" label={tr('mobile.qr.done')} onPress={close} />}>
        <ResultState kind="expired" />
      </Screen>
    );
  }

  const place = locationLabel(d.location);
  const DeviceIcon = d.client.device_type === 'mobile' ? Smartphone : d.client.device_type === 'tablet' ? TabletSmartphone : Monitor;
  const busy = answer.isPending;

  return (
    <Screen
      header={header}
      footer={
        <Row gap={t.spacing.sm}>
          <Button
            size="lg"
            variant="outline"
            label={tr('mobile.qr.reject')}
            icon={<CircleX size={18} color={t.colors.text} />}
            style={{ flex: 1 }}
            disabled={busy}
            loading={busy && answer.variables === 'rejected'}
            onPress={() => answer.mutate('rejected')}
          />
          <Button
            size="lg"
            label={tr('mobile.qr.approve')}
            icon={<CircleCheck size={18} color={t.colors.onPrimary} />}
            style={{ flex: 1 }}
            disabled={busy}
            loading={busy && answer.variables === 'approved'}
            onPress={() => answer.mutate('approved')}
            accessibilityHint={tr('mobile.qr.approve_hint')}
          />
        </Row>
      }
    >
      <View style={{ alignItems: 'center', gap: t.spacing.sm, paddingVertical: t.spacing.md }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <DeviceIcon size={30} color={t.colors.primary} />
        </View>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          {tr('mobile.qr.request_title')}
        </Txt>
        <Txt tone="secondary" style={{ textAlign: 'center' }}>
          {tr('mobile.qr.request_body', { account: me?.user.email ?? '', organization: organization?.name ?? '' })}
        </Txt>
      </View>

      <Card>
        <InfoRow label={tr('mobile.qr.browser')} value={clientLabel(d.client, tr('mobile.qr.unknown'))} />
        <InfoRow label={tr('mobile.qr.location')} value={place ?? tr('mobile.qr.location_unknown')} />
        <InfoRow label={tr('mobile.qr.ip')} value={d.ip} />
        <InfoRow label={tr('mobile.qr.requested_at')} value={fmt.dateTime(d.created_at)} />
        {organization ? <InfoRow label={tr('mobile.qr.organization')} value={organization.name} /> : null}
        <InfoRow label={tr('mobile.qr.account')} value={me?.user.email ?? ''} last />
      </Card>

      <Card style={{ backgroundColor: t.colors.warningBg, borderColor: t.colors.warningBg }}>
        <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
          <ShieldAlert size={20} color={t.colors.warning} />
          <Txt variant="caption" style={{ flex: 1 }}>
            {tr('mobile.qr.warning')}
          </Txt>
        </Row>
      </Card>

      {remaining !== null ? (
        <Row gap={t.spacing.xs} style={{ justifyContent: 'center' }}>
          <Clock size={14} color={t.colors.textMuted} />
          <Txt variant="caption" tone="muted">
            {tr('mobile.qr.expires_in', { seconds: remaining })}
          </Txt>
        </Row>
      ) : null}
    </Screen>
  );
}

/** Seconds until `expiresAt`, ticking once a second (null until known). */
function useRemainingSeconds(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const end = new Date(expiresAt).getTime();
    if (!(end > Date.now())) return;
    // Stops ticking once the request has expired.
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= end) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

type ResultKind = Outcome | 'expired' | 'claimed' | 'resolved' | 'deactivated' | 'invalid';

function ResultState({ kind }: { kind: ResultKind }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const good = kind === 'approved';
  const Icon = good ? CircleCheck : kind === 'rejected' ? CircleX : ShieldAlert;
  const color = good ? t.colors.success : kind === 'rejected' ? t.colors.textSecondary : t.colors.warning;
  return <EmptyState icon={<Icon size={28} color={color} />} title={tr(`mobile.qr.result_${kind}_title`)} description={tr(`mobile.qr.result_${kind}`)} />;
}
