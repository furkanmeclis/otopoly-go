/**
 * Self-serve sign-up (mirrors the web /register account step, then the e-mail is proven by code):
 *
 *   1. Account: name, surname, e-mail, optional password (backend policy), terms + privacy / KVKK consent.
 *      With a password → POST /v1/auth/register (409 → "this e-mail already has an account").
 *   2. Code: POST /v1/auth/email-code/request → /verify. The code signs in, marks the e-mail verified and,
 *      without a password, creates the account (then PATCH /v1/auth/profile saves the typed name).
 *   3. Signed in without a business → select-org forwards to create-business (same path Apple / Google
 *      first-time users take).
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, Circle, CircleCheck, Eye, EyeOff, Lock, Mail, UserRound } from 'lucide-react-native';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '@/api/errors';
import { getIssuedCodes, subscribeIssuedCodes } from '@/api/mock/demo-auth';
import { useToast } from '@/components/feedback/toast';
import { Button, EmptyState, Header, Row, SwitchRow, TextField, Txt } from '@/components/ui';
import { isMock } from '@/config/env';
import { useOpenLegal } from '@/features/account/components/legal-links';
import { authService } from '@/features/account/services/auth.service';
import { CODE_LENGTH, CodeField, Notice, ResendLink, TotpField, useCountdown } from '@/features/auth/components/code-entry';
import { authErrorMessage } from '@/features/auth/lib/auth-errors';
import { passwordlessService } from '@/features/auth/services/passwordless.service';
import { isFreshCodeAccount, PASSWORD_RULES, passwordValid, registerService, type PasswordRule } from '@/features/auth/services/register.service';
import { useSignInFlow } from '@/features/auth/use-sign-in-flow';
import { onboardingService, registrationOpen } from '@/features/onboarding/services/onboarding.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useMarkInteractive } from '@/lib/monitoring/observe';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.register');
const EMAIL_RE = /^\S+@\S+\.\S+$/;

type Values = { name: string; surname: string; email: string; password: string };
type Field = keyof Values | 'consent';

export default function RegisterScreen() {
  useMarkInteractive();
  const t = useTheme();
  const { t: tr } = useLocale();
  const config = useQuery({ queryKey: ['app', 'config'], queryFn: () => onboardingService.appConfig(), staleTime: 5 * 60 * 1000, retry: 1 });
  const [step, setStep] = useState<'account' | 'code'>('account');
  const [values, setValues] = useState<Values>({ name: '', surname: '', email: '', password: '' });
  const [withPassword, setWithPassword] = useState(false);
  /** E-mail registered with a password on this screen (kept when going back from the code step). */
  const registeredRef = useRef<string | null>(null);

  const open = registrationOpen(config.data);
  // Password sign-up has its own switch (auth_methods.password.register); the code path only needs registration.
  const passwordAllowed = config.data?.auth_methods?.password?.register !== false;

  const back = () => {
    if (step === 'code') setStep('account');
    else if (router.canGoBack()) router.back();
    else router.replace('/login');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header title={tr('mobile.auth.register.title')} subtitle={tr('register.onboarding.step_of', { current: step === 'account' ? 1 : 2, total: 2 })} onBack={back} />
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: t.spacing.xl, paddingTop: t.spacing.sm, gap: t.spacing.xl }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <StepBar step={step === 'account' ? 0 : 1} />
          {config.isLoading ? (
            <ActivityIndicator color={t.colors.primary} style={{ marginTop: t.spacing.xxl }} />
          ) : !open ? (
            <EmptyState
              icon={<UserRound size={28} color={t.colors.primary} />}
              title={tr('mobile.auth.register.closed_title')}
              description={tr('mobile.auth.register.closed_body')}
              action={<Button label={tr('mobile.auth.register.to_login')} variant="outline" onPress={() => router.replace('/login')} />}
            />
          ) : step === 'account' ? (
            <AccountStep
              values={values}
              setValues={setValues}
              withPassword={withPassword && passwordAllowed}
              passwordAllowed={passwordAllowed}
              setWithPassword={setWithPassword}
              registeredRef={registeredRef}
              onDone={() => setStep('code')}
            />
          ) : (
            <CodeStep values={values} withPassword={withPassword && passwordAllowed} onChangeEmail={() => setStep('account')} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepBar({ step }: { step: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessible={false} importantForAccessibility="no-hide-descendants">
      {[0, 1].map((i) => (
        <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? t.colors.primary : t.colors.surfaceSunken }} />
      ))}
    </View>
  );
}

// ─── Step 1: account ───────────────────────────────────────────────────────

function AccountStep({
  values,
  setValues,
  withPassword,
  passwordAllowed,
  setWithPassword,
  registeredRef,
  onDone,
}: {
  values: Values;
  setValues: (fn: (v: Values) => Values) => void;
  withPassword: boolean;
  passwordAllowed: boolean;
  setWithPassword: (v: boolean) => void;
  registeredRef: RefObject<string | null>;
  onDone: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const surnameRef = useRef<TextInputInstance>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const set = (field: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (field === 'email') setExisting(false);
  };

  const validate = () => {
    const found: Partial<Record<Field, string>> = {};
    if (!values.name.trim()) found.name = tr('mobile.auth.register.name_required');
    if (!values.surname.trim()) found.surname = tr('mobile.auth.register.surname_required');
    if (!EMAIL_RE.test(values.email.trim())) found.email = tr('auth.validation.email');
    if (withPassword && !passwordValid(values.password)) found.password = tr('mobile.auth.register.password_invalid');
    if (!consent) found.consent = tr('mobile.auth.register.consent_required');
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const submit = async () => {
    if (busy || !validate()) return;
    const email = values.email.trim().toLowerCase();
    setValues((v) => ({ ...v, email, name: v.name.trim(), surname: v.surname.trim() }));
    setError(null);
    setExisting(false);
    setBusy(true);
    try {
      // Registered a moment ago but the code request failed (e.g. 429): don't register twice (→ 409).
      if (withPassword && registeredRef.current !== email) {
        await registerService.register({ email, password: values.password, name: values.name.trim(), surname: values.surname.trim() });
        registeredRef.current = email;
        log.info('Account registered with password');
      }
      await passwordlessService.requestEmailCode(email);
      onDone();
    } catch (err) {
      const code = isApiError(err) ? err.code : 'UNKNOWN';
      log.warn('Sign-up step failed', { code, withPassword });
      if (code === 'CONFLICT') setExisting(true);
      else if (code === 'VALIDATION_ERROR' && withPassword) setErrors((e) => ({ ...e, password: tr('mobile.auth.register.password_invalid') }));
      else if (code === 'FORBIDDEN') setError(tr('mobile.auth.register.password_closed'));
      else setError(authErrorMessage(tr, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: t.spacing.lg }}>
      <View style={{ gap: 4 }}>
        <Txt variant="heading" accessibilityRole="header">
          {tr('mobile.auth.register.account_title')}
        </Txt>
        <Txt tone="secondary">{tr('mobile.auth.register.account_body')}</Txt>
      </View>

      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={tr('register.fields.name')}
            value={values.name}
            onChangeText={set('name')}
            error={errors.name}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => surnameRef.current?.focus()}
            maxLength={80}
            required
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            ref={surnameRef}
            label={tr('register.fields.surname')}
            value={values.surname}
            onChangeText={set('surname')}
            error={errors.surname}
            autoCapitalize="words"
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            maxLength={80}
            required
          />
        </View>
      </Row>
      <TextField
        ref={emailRef}
        label={tr('auth.fields.email')}
        value={values.email}
        onChangeText={set('email')}
        error={errors.email}
        hint={tr('mobile.auth.register.email_hint')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType={withPassword ? 'next' : 'done'}
        onSubmitEditing={() => (withPassword ? passwordRef.current?.focus() : undefined)}
        left={<Mail size={18} color={t.colors.textMuted} />}
        required
      />

      {passwordAllowed ? (
        <View style={{ gap: t.spacing.md }}>
          <SwitchRow label={tr('mobile.auth.register.password_toggle')} description={tr('mobile.auth.register.password_toggle_hint')} value={withPassword} onValueChange={setWithPassword} />
          {withPassword ? (
            <>
              <TextField
                ref={passwordRef}
                label={tr('auth.fields.password')}
                value={values.password}
                onChangeText={set('password')}
                error={errors.password}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                passwordRules="minlength: 8; required: lower; required: upper; required: digit;"
                returnKeyType="done"
                left={<Lock size={18} color={t.colors.textMuted} />}
                right={
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr(showPassword ? 'mobile.auth.register.hide_password' : 'mobile.auth.register.show_password')}>
                    {showPassword ? <EyeOff size={18} color={t.colors.textMuted} /> : <Eye size={18} color={t.colors.textMuted} />}
                  </Pressable>
                }
              />
              <PasswordChecklist value={values.password} />
            </>
          ) : null}
        </View>
      ) : null}

      <ConsentRow checked={consent} onToggle={() => {
        setConsent((c) => !c);
        if (errors.consent) setErrors((e) => ({ ...e, consent: undefined }));
      }} error={errors.consent} />

      {existing ? (
        <View style={{ gap: t.spacing.sm }}>
          <Notice tone="info" message={tr('mobile.auth.register.exists')} />
          <Button label={tr('mobile.auth.register.to_login')} variant="outline" onPress={() => router.replace('/login')} />
        </View>
      ) : null}
      {error ? <Notice message={error} /> : null}

      <Button label={tr('mobile.auth.register.continue')} onPress={() => void submit()} loading={busy} size="lg" fullWidth />

      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {tr('mobile.auth.register.social_hint')}
      </Txt>
      <Pressable onPress={() => router.replace('/login')} accessibilityRole="link" style={{ alignSelf: 'center', padding: t.spacing.sm }}>
        <Txt variant="caption" tone="secondary">
          {tr('mobile.auth.register.have_account')}{' '}
          <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
            {tr('auth.login.submit')}
          </Txt>
        </Txt>
      </Pressable>
    </View>
  );
}

function PasswordChecklist({ value }: { value: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const label: Record<PasswordRule, string> = {
    length: tr('mobile.auth.register.rule_length'),
    lower: tr('mobile.auth.register.rule_lower'),
    upper: tr('mobile.auth.register.rule_upper'),
    digit: tr('mobile.auth.register.rule_digit'),
  };
  return (
    <View style={{ gap: 4 }}>
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <Row key={rule.key} gap={6} style={{ alignItems: 'center' }}>
            <View accessible accessibilityLabel={`${label[rule.key]}: ${ok ? tr('mobile.auth.register.rule_ok') : tr('mobile.auth.register.rule_missing')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {ok ? <CircleCheck size={14} color={t.colors.success} /> : <Circle size={14} color={t.colors.textMuted} />}
              <Txt variant="caption" tone={ok ? 'success' : 'muted'}>
                {label[rule.key]}
              </Txt>
            </View>
          </Row>
        );
      })}
    </View>
  );
}

function ConsentRow({ checked, onToggle, error }: { checked: boolean; onToggle: () => void; error?: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const openLegal = useOpenLegal();
  return (
    <View style={{ gap: 6 }}>
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={tr('mobile.auth.register.consent_a11y')}
          hitSlop={10}
          style={{ minWidth: 44, minHeight: 44, marginLeft: -10, marginTop: -10, alignItems: 'center', justifyContent: 'center' }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              borderWidth: 1.5,
              borderColor: error ? t.colors.danger : checked ? t.colors.primary : t.colors.borderStrong,
              backgroundColor: checked ? t.colors.primary : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {checked ? <Check size={16} color={t.colors.onPrimary} /> : null}
          </View>
        </Pressable>
        <Txt variant="caption" tone="secondary" style={{ flex: 1, lineHeight: 19 }}>
          {tr('mobile.auth.register.consent_prefix') ? `${tr('mobile.auth.register.consent_prefix')} ` : ''}
          <Txt variant="caption" tone="primary" style={{ textDecorationLine: 'underline' }} onPress={() => void openLegal('terms')} accessibilityRole="link">
            {tr('mobile.account.legal.terms')}
          </Txt>
          {tr('mobile.auth.register.consent_middle')}{' '}
          <Txt variant="caption" tone="primary" style={{ textDecorationLine: 'underline' }} onPress={() => void openLegal('privacy')} accessibilityRole="link">
            {tr('mobile.auth.register.privacy_kvkk')}
          </Txt>
          {tr('mobile.auth.register.consent_suffix')}
        </Txt>
      </Row>
      {error ? (
        <Txt variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

// ─── Step 2: e-mail code ───────────────────────────────────────────────────

function CodeStep({ values, withPassword, onChangeEmail }: { values: Values; withPassword: boolean; onChangeEmail: () => void }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const toast = useToast();
  const flow = useSignInFlow();
  const cooldown = useCountdown();
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const demoCode = useDemoCode(values.email);
  const restartCooldown = cooldown.restart;
  // The first code went out with "Continue": the resend link starts on its cooldown.
  useEffect(() => {
    restartCooldown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** New account from a code alone: save the typed name (a password sign-up already sent it). */
  const prepare = async () => {
    const profile = await authService.getMe();
    if (withPassword) return;
    if (!isFreshCodeAccount(profile)) {
      log.info('Code sign-up reached an existing account');
      toast.info(tr('mobile.auth.register.signed_in_existing'));
      return;
    }
    await authService.updateProfile({ name: values.name, surname: values.surname, locale: locale === 'en' ? 'en' : 'tr' });
    log.info('New account profile saved');
  };

  const verify = async (value = code) => {
    if (flow.busy) return;
    if (value.length !== CODE_LENGTH) {
      setCodeError(tr('mobile.auth.code.invalid_length'));
      return;
    }
    setCodeError(null);
    setError(null);
    const message = await flow.run((totpCode) => passwordlessService.verifyEmailCode(values.email, value, totpCode), undefined, { prepare });
    if (message) {
      setError(message);
      setCode('');
    }
  };

  const resend = async () => {
    setSending(true);
    setError(null);
    try {
      await passwordlessService.requestEmailCode(values.email);
      cooldown.restart();
      toast.success(tr('mobile.auth.code.resent'));
    } catch (err) {
      if (isApiError(err) && err.code === 'RATE_LIMITED' && err.retryAfter) cooldown.restart(err.retryAfter);
      setError(authErrorMessage(tr, err));
    } finally {
      setSending(false);
    }
  };

  if (flow.mfa) {
    // Only an existing account with an authenticator lands here (a new one has no 2FA yet).
    const submitTotp = async () => {
      if (!totp.trim()) return;
      setError(await flow.submitTotp(totp.replace(/\s/g, '')));
    };
    return (
      <View style={{ gap: t.spacing.lg }}>
        <Notice tone="info" message={tr('mobile.auth.register.exists_totp')} />
        <TotpField value={totp} onChange={setTotp} onSubmit={() => void submitTotp()} />
        {error ? <Notice message={error} /> : null}
        <Button label={tr('auth.totp.verify_login')} onPress={() => void submitTotp()} loading={flow.busy} size="lg" fullWidth />
        <Button label={tr('mobile.auth.totp.back')} variant="ghost" onPress={flow.cancelMfa} disabled={flow.busy} />
      </View>
    );
  }

  return (
    <View style={{ gap: t.spacing.lg }}>
      <View style={{ gap: 4 }}>
        <Txt variant="heading" accessibilityRole="header">
          {tr('mobile.auth.register.code_title')}
        </Txt>
        <Txt tone="secondary">{tr('mobile.auth.register.code_body', { email: values.email })}</Txt>
      </View>
      <CodeField value={code} onChange={setCode} onComplete={(c) => void verify(c)} error={codeError} editable={!flow.busy} />
      {error ? <Notice message={error} /> : null}
      <Button label={tr('mobile.auth.register.verify')} onPress={() => void verify()} loading={flow.busy} size="lg" fullWidth />
      <ResendLink remaining={cooldown.remaining} onPress={() => void resend()} disabled={sending} />
      <Pressable onPress={onChangeEmail} accessibilityRole="button" style={{ alignSelf: 'center', padding: t.spacing.sm }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('mobile.auth.code.change_email')}
        </Txt>
      </Pressable>
      {demoCode ? (
        <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {tr('mobile.auth.register.demo_code', { code: demoCode })}
        </Txt>
      ) : null}
    </View>
  );
}

/** Demo builds: the mock "e-mails" the code to the diagnostics screen; show it right here instead. */
function useDemoCode(email: string) {
  const codes = useSyncExternalStore(subscribeIssuedCodes, getIssuedCodes);
  if (!isMock) return null;
  return codes.find((c) => c.email === email && c.purpose === 'login')?.code ?? null;
}
