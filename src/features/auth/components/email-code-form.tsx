import { Mail } from 'lucide-react-native';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Button, TextField, Txt } from '@/components/ui';
import { authErrorMessage } from '@/features/auth/lib/auth-errors';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { CODE_LENGTH, CodeField, Notice, ResendLink, useCountdown } from './code-entry';

const log = createLogger('auth.email_code');
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * E-mail → 6-digit code → sign in. Used for "E-posta ile kod" on the login screen and for the
 * "I have an account" branch of Apple private-relay linking. The request answers the same way
 * whether or not the address has an account, so the copy never confirms that it exists.
 */
export function EmailCodeForm({
  requestCode,
  verify,
  description,
  emailLabel,
  submitLabel,
  provider,
  busy,
  footer,
}: {
  requestCode: (email: string) => Promise<unknown>;
  /** Resolves with an error message to show, or `null` when the flow moved on (signed in, TOTP step…). */
  verify: (email: string, code: string) => Promise<string | null>;
  description: string;
  emailLabel?: string;
  submitLabel: string;
  /** Names Apple / Google in errors of the linking flow. */
  provider?: OAuthProvider;
  busy?: boolean;
  /** Shown under the form (demo hints). */
  footer?: ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const cooldown = useCountdown();
  const verifyingRef = useRef(false);

  const send = async (resend = false) => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setEmailError(tr('auth.validation.email'));
      return;
    }
    setEmailError(null);
    setError(null);
    setSending(true);
    try {
      await requestCode(e);
      log.info('Code requested', { resend });
      setEmail(e);
      setCode('');
      setCodeError(null);
      setStep('code');
      cooldown.restart();
      if (resend) toast.success(tr('mobile.auth.code.resent'));
    } catch (err) {
      if (isApiError(err) && err.code === 'RATE_LIMITED' && err.retryAfter) cooldown.restart(err.retryAfter);
      if (isApiError(err) && err.code === 'VALIDATION_ERROR') setEmailError(tr('auth.validation.email'));
      else setError(authErrorMessage(tr, err, provider));
    } finally {
      setSending(false);
    }
  };

  const submit = async (value = code) => {
    if (verifyingRef.current) return;
    if (value.length !== CODE_LENGTH) {
      setCodeError(tr('mobile.auth.code.invalid_length'));
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    setCodeError(null);
    setError(null);
    try {
      const message = await verify(email, value);
      if (message) {
        setError(message);
        setCode('');
      }
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  if (step === 'email') {
    return (
      <View style={{ gap: t.spacing.lg }}>
        <Txt tone="secondary">{description}</Txt>
        <TextField
          label={emailLabel ?? tr('auth.fields.email')}
          value={email}
          onChangeText={setEmail}
          error={emailError}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="send"
          onSubmitEditing={() => send()}
          left={<Mail size={18} color={t.colors.textMuted} />}
        />
        {error ? <Notice message={error} /> : null}
        <Button label={tr('mobile.auth.code.send')} onPress={() => send()} loading={sending} disabled={busy || cooldown.remaining > 0} size="lg" fullWidth />
        {cooldown.remaining > 0 ? (
          <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {tr('mobile.auth.code.resend_in', { seconds: cooldown.remaining })}
          </Txt>
        ) : null}
        {footer}
      </View>
    );
  }

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt tone="secondary">{tr('mobile.auth.code.sent_to', { email })}</Txt>
      <CodeField value={code} onChange={setCode} onComplete={(c) => submit(c)} error={codeError} editable={!verifying && !busy} />
      {error ? <Notice message={error} /> : null}
      <Button label={submitLabel} onPress={() => submit()} loading={verifying || busy} size="lg" fullWidth />
      <ResendLink remaining={cooldown.remaining} onPress={() => send(true)} disabled={sending} />
      <Pressable
        onPress={() => {
          setStep('email');
          setError(null);
          setCode('');
        }}
        accessibilityRole="button"
        style={{ alignSelf: 'center', padding: t.spacing.sm }}
      >
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('mobile.auth.code.change_email')}
        </Txt>
      </Pressable>
      {footer}
    </View>
  );
}
