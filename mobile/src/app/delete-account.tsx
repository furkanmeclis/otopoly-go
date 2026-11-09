import { Archive, Ban, Building2, History, LogOut, Trash2 } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { isApiError } from '@/api/errors';
import { DEMO_EMAIL_CODE } from '@/api/mock/demo-auth';
import { useToast } from '@/components/feedback/toast';
import { Button, Card, Header, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { isMock } from '@/config/env';
import { LegalLinks } from '@/features/account/components/legal-links';
import { useAuth } from '@/features/auth/auth-provider';
import { CODE_LENGTH, CodeField, Notice, ResendLink, useCountdown } from '@/features/auth/components/code-entry';
import { authErrorMessage } from '@/features/auth/lib/auth-errors';
import { passwordlessService } from '@/features/auth/services/passwordless.service';
import { registerPushDevice, unregisterPushDevice } from '@/features/notifications/push';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.delete_account');

/**
 * Profile → "Hesabımı sil" (App Store 5.1.1(v)). The backend disables the account at once (every
 * session ends, Apple access is revoked), keeps it recoverable for 30 days on the web page
 * (otopoly.app/account/delete?mode=recover), then anonymizes the personal data. Business records
 * stay. Confirmation is a 6-digit code e-mailed to the account (works for passwordless accounts too).
 */
export default function DeleteAccountScreen() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { me, logout } = useAuth();
  const email = me?.user.email ?? '';
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const cooldown = useCountdown();

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      await passwordlessService.requestDeactivationCode();
      log.info('Deactivation code requested');
      setCodeSent(true);
      setCode('');
      cooldown.restart();
    } catch (err) {
      if (isApiError(err) && err.code === 'RATE_LIMITED' && err.retryAfter) cooldown.restart(err.retryAfter);
      setError(authErrorMessage(tr, err));
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (code.length !== CODE_LENGTH) {
      setCodeError(tr('mobile.auth.code.invalid_length'));
      return;
    }
    setCodeError(null);
    const ok = await confirm({
      title: tr('mobile.auth.delete.confirm_title'),
      message: tr('mobile.auth.delete.confirm_body'),
      confirmLabel: tr('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    // Unregister push while the access token still works: deactivation revokes every session.
    await unregisterPushDevice();
    try {
      const result = await passwordlessService.deactivate(code);
      log.info('Account deletion scheduled, signing out locally', { on: result.deletion_scheduled_on });
      toast.success(tr('mobile.auth.delete.done', { date: fmt.date(result.deletion_scheduled_on) }));
      // The server already revoked every session; only clear this device.
      await logout({ serverRevoked: true });
    } catch (err) {
      const c = isApiError(err) ? err.code : 'UNKNOWN';
      log.warn('Deactivation failed', { code: c });
      // Still signed in: put this device back (never prompts, never throws).
      void registerPushDevice({ force: true });
      setCode('');
      setError(
        c === 'STEP_UP_REQUIRED'
          ? tr('mobile.auth.delete.step_up')
          : c === 'CONFLICT'
            ? tr('mobile.auth.delete.conflict')
            : authErrorMessage(tr, err),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen
      header={<Header title={tr('mobile.auth.delete.title')} subtitle={email} />}
      footer={
        codeSent ? (
          <Button
            label={tr('mobile.auth.delete.submit')}
            variant="danger"
            size="lg"
            icon={<Trash2 size={18} color="#FFFFFF" />}
            loading={deleting}
            onPress={remove}
          />
        ) : (
          <Button label={tr('mobile.auth.delete.send_code')} size="lg" loading={sending} onPress={sendCode} disabled={cooldown.remaining > 0} />
        )
      }
    >
      <Section title={tr('mobile.auth.delete.what_title')}>
        <Card style={{ gap: t.spacing.md }}>
          <Point icon={<Ban size={18} color={t.colors.danger} />} text={tr('mobile.auth.delete.point_closed')} />
          <Point icon={<History size={18} color={t.colors.textSecondary} />} text={tr('mobile.auth.delete.point_recover')} />
          <Point icon={<LogOut size={18} color={t.colors.textSecondary} />} text={tr('mobile.auth.delete.point_sessions')} />
          <Point icon={<Archive size={18} color={t.colors.textSecondary} />} text={tr('mobile.auth.delete.point_data')} />
          <Point icon={<Building2 size={18} color={t.colors.textSecondary} />} text={tr('mobile.auth.delete.point_org')} />
        </Card>
        <LegalLinks notice={tr('mobile.account.legal.delete_hint')} docs={['privacy']} />
      </Section>

      <Section title={tr('mobile.auth.delete.code_title')}>
        <View style={{ gap: t.spacing.md }}>
          <Txt variant="caption" tone="secondary">
            {codeSent ? tr('mobile.auth.delete.code_sent', { email }) : tr('mobile.auth.delete.code_hint', { email })}
          </Txt>
          {codeSent ? (
            <>
              <CodeField value={code} onChange={setCode} error={codeError} editable={!deleting} />
              <ResendLink remaining={cooldown.remaining} onPress={sendCode} disabled={sending} />
            </>
          ) : null}
          {error ? <Notice message={error} /> : null}
          {isMock && codeSent ? (
            <Txt variant="caption" tone="muted">
              {tr('mobile.auth.demo.code_hint', { code: DEMO_EMAIL_CODE })}
            </Txt>
          ) : null}
        </View>
      </Section>
    </Screen>
  );
}

function Point({ icon, text }: { icon: ReactNode; text: string }) {
  const t = useTheme();
  return (
    <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <Txt style={{ flex: 1 }}>{text}</Txt>
    </Row>
  );
}
