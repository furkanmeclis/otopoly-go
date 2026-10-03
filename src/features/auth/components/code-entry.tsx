import { KeyRound, ShieldCheck } from 'lucide-react-native';
import { forwardRef, useEffect, useState } from 'react';
import { Platform, Pressable, type TextInput } from 'react-native';

import { Row, TextField, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export const CODE_LENGTH = 6;
/** Seconds before "Resend code" becomes active again. */
export const RESEND_COOLDOWN = 60;

export const normalizeCode = (value: string) => value.replace(/\D/g, '').slice(0, CODE_LENGTH);

/**
 * 6-digit e-mail code input. iOS offers the code from Mail as an AutoFill suggestion
 * (`oneTimeCode`), Android autofills from the SMS / e-mail retriever (`sms-otp`).
 * Calls `onComplete` once all six digits are in.
 */
export const CodeField = forwardRef<
  TextInput,
  { value: string; onChange: (v: string) => void; onComplete?: (code: string) => void; label?: string; error?: string | null; editable?: boolean }
>(function CodeField({ value, onChange, onComplete, label, error, editable = true }, ref) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <TextField
      ref={ref}
      label={label ?? tr('mobile.auth.code.label')}
      value={value}
      onChangeText={(v) => {
        const next = normalizeCode(v);
        onChange(next);
        if (next.length === CODE_LENGTH && next !== value) onComplete?.(next);
      }}
      error={error ?? undefined}
      placeholder={tr('mobile.auth.code.placeholder')}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
      maxLength={CODE_LENGTH}
      editable={editable}
      autoFocus
      left={<KeyRound size={18} color={t.colors.textMuted} />}
      style={{ letterSpacing: 6, fontVariant: ['tabular-nums'] }}
      accessibilityHint={tr('mobile.auth.code.placeholder')}
    />
  );
});

/** Authenticator (TOTP) code field — the same 2FA input the password login used. */
export function TotpField({ value, onChange, error, onSubmit }: { value: string; onChange: (v: string) => void; error?: string | null; onSubmit?: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <TextField
      label={tr('auth.totp.login_title')}
      value={value}
      onChangeText={onChange}
      error={error ?? undefined}
      placeholder={tr('auth.totp.code_placeholder')}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      autoCapitalize="none"
      returnKeyType="go"
      onSubmitEditing={onSubmit}
      autoFocus
      left={<ShieldCheck size={18} color={t.colors.textMuted} />}
    />
  );
}

/** Counts down from `seconds` after each `restart()`; `remaining` is 0 when the action is allowed. */
export function useCountdown(seconds = RESEND_COOLDOWN) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    // Stops itself once the cooldown is over (it used to re-render every 500 ms for as long as the screen lived).
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [until]);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  return {
    remaining,
    restart: (s: number = seconds) => {
      setNow(Date.now());
      setUntil(Date.now() + s * 1000);
    },
  };
}

/** "Resend code" link with its cooldown. */
export function ResendLink({ remaining, onPress, disabled }: { remaining: number; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const waiting = remaining > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={waiting || disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: waiting || disabled }}
      style={{ alignSelf: 'center', padding: t.spacing.sm }}
    >
      <Row gap={6}>
        <Txt variant="caption" tone={waiting ? 'muted' : 'primary'} style={{ fontWeight: '700' }} accessibilityLiveRegion="polite">
          {waiting ? tr('mobile.auth.code.resend_in', { seconds: remaining }) : tr('mobile.auth.code.resend')}
        </Txt>
      </Row>
    </Pressable>
  );
}

/** Inline error / info box used across the sign-in screens. */
export function Notice({ message, tone = 'danger' }: { message: string; tone?: 'danger' | 'info' }) {
  const t = useTheme();
  return (
    <Row
      style={{ backgroundColor: tone === 'danger' ? t.colors.dangerBg : t.colors.infoBg, borderRadius: t.radius.md, padding: t.spacing.md }}
      gap={0}
    >
      <Txt tone={tone === 'danger' ? 'danger' : 'info'} variant="caption" style={{ fontWeight: '600', flex: 1 }} accessibilityLiveRegion="polite">
        {message}
      </Txt>
    </Row>
  );
}
