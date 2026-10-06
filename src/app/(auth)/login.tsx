import { Link, router, useLocalSearchParams } from 'expo-router';
import { Bug, Eye, EyeOff, KeyRound, Lock, Mail, UserCog, UserRound } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_EMAIL_CODE, DEMO_TOTP_CODE, demoIdToken, type DemoIdentity } from '@/api/mock/demo-auth';
import { BrandMark } from '@/components/brand';
import { Button, Card, Row, Segmented, TextField, Txt } from '@/components/ui';
import { devToolsEnabled, isMock, qaTourEnabled } from '@/config/env';
import { LegalLinks } from '@/features/account/components/legal-links';
import { authService } from '@/features/account/services/auth.service';
import { useAuth } from '@/features/auth/auth-provider';
import { Notice, TotpField } from '@/features/auth/components/code-entry';
import { EmailCodeForm } from '@/features/auth/components/email-code-form';
import { DemoIdentitySheet, LinkAccountSheet, NotLinkedNotice } from '@/features/auth/components/oauth-sheets';
import { SocialButtons } from '@/features/auth/components/social-buttons';
import { authErrorMessage, PROVIDER_NAME } from '@/features/auth/lib/auth-errors';
import { signInWithAppleNative, signInWithGoogleNative } from '@/features/auth/native/social';
import { passwordlessService, type OAuthProvider } from '@/features/auth/services/passwordless.service';
import { useSignInFlow } from '@/features/auth/use-sign-in-flow';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.login');
const DEMO = { owner: 'demo@otopoly.com', staff: 'personel@otopoly.com', totp: 'ali@parlakoto.com', password: 'demo1234' };

type Mode = 'password' | 'code';

export default function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { login } = useAuth();
  const flow = useSignInFlow();
  const [mode, setMode] = useState<Mode>('password');
  const [error, setError] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState<OAuthProvider | null>(null);
  const [demoProvider, setDemoProvider] = useState<OAuthProvider | null>(null);

  // Demo builds only: `otopoly://login?demo=owner|staff` signs in with a demo account (QA screenshots, demos).
  const { demo: demoParam } = useLocalSearchParams<{ demo?: string }>();
  const demoLinkUsed = useRef(false);
  useEffect(() => {
    const who = qaTourEnabled ? 'owner' : demoParam;
    if (!isMock || demoLinkUsed.current || (who !== 'owner' && who !== 'staff')) return;
    demoLinkUsed.current = true;
    log.info('Demo sign-in', { as: who, qaTour: qaTourEnabled });
    login(DEMO[who], DEMO.password).catch((err) => log.warn('Demo deep-link sign-in failed', err));
  }, [demoParam, login]);

  const social = async (provider: OAuthProvider) => {
    setError(null);
    if (isMock) {
      setDemoProvider(provider);
      return;
    }
    setSocialBusy(provider);
    try {
      const input = provider === 'apple' ? await signInWithAppleNative() : await signInWithGoogleNative();
      if (!input) return; // cancelled in the native sheet
      setError(await flow.run((totp) => passwordlessService.nativeOAuth(provider, input, totp), provider));
    } catch (err) {
      log.warn('Native sign-in failed', { provider, error: String((err as Error)?.message ?? err) });
      const unavailable = /UNAVAILABLE/.test(String((err as Error)?.message));
      setError(unavailable ? tr('mobile.auth.error.provider_unavailable', { provider: PROVIDER_NAME[provider] }) : tr('auth.oauth.sign_in_error'));
    } finally {
      setSocialBusy(null);
    }
  };

  const demoIdentity = async (identity: DemoIdentity) => {
    setDemoProvider(null);
    const nonce = Math.random().toString(36).slice(2);
    const input = { id_token: demoIdToken(identity, nonce), nonce, given_name: identity.given_name, family_name: identity.family_name };
    setSocialBusy(identity.provider);
    try {
      setError(await flow.run((totp) => passwordlessService.nativeOAuth(identity.provider, input, totp), identity.provider));
    } finally {
      setSocialBusy(null);
    }
  };

  const busy = flow.busy || socialBusy !== null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: t.spacing.xxl, gap: t.spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: t.spacing.md }}>
            <BrandMark height={64} style={{ marginBottom: t.spacing.sm }} />
            <Txt variant="display">Otopoly</Txt>
            <Txt tone="secondary" style={{ textAlign: 'center' }}>
              {flow.mfa ? tr('auth.totp.login_description') : tr('organizations.login.description')}
            </Txt>
          </View>

          {flow.mfa ? (
            <TotpStep flow={flow} />
          ) : (
            <View style={{ gap: t.spacing.lg }}>
              <Segmented<Mode>
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setError(null);
                }}
                options={[
                  { value: 'password', label: tr('mobile.auth.mode.password') },
                  { value: 'code', label: tr('mobile.auth.mode.code') },
                ]}
              />
              {flow.notLinked ? (
                <NotLinkedNotice
                  provider={flow.notLinked}
                  onUseCode={() => {
                    flow.hideNotLinked();
                    setMode('code');
                  }}
                  onDismiss={flow.clearNotLinked}
                />
              ) : null}
              {mode === 'password' ? (
                <PasswordForm flow={flow} error={error} setError={setError} disabled={busy} />
              ) : (
                <EmailCodeForm
                  description={tr('mobile.auth.code.description')}
                  submitLabel={tr('mobile.auth.code.submit')}
                  busy={busy}
                  requestCode={(email) => passwordlessService.requestEmailCode(email)}
                  verify={(email, code) => flow.run((totp) => passwordlessService.verifyEmailCode(email, code, totp))}
                  footer={
                    isMock ? (
                      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                        {tr('mobile.auth.demo.code_hint', { code: DEMO_EMAIL_CODE })}
                      </Txt>
                    ) : null
                  }
                />
              )}
              {mode === 'code' && error ? <Notice message={error} /> : null}
              <SocialButtons onPress={social} busy={socialBusy} disabled={busy} />
            </View>
          )}

          {isMock && !flow.mfa ? <DemoCard onPick={(who) => login(DEMO[who], DEMO.password).catch((err) => setError(authErrorMessage(tr, err)))} disabled={busy} /> : null}

          <LegalLinks notice={tr('mobile.account.legal.login_notice')} />

          {devToolsEnabled ? (
            <Pressable onPress={() => router.push('/diagnostics')} style={{ alignSelf: 'center', padding: t.spacing.sm }} accessibilityRole="button" accessibilityLabel={tr('mobile.diagnostics.title')}>
              <Row gap={6}>
                <Bug size={14} color={t.colors.textMuted} />
                <Txt variant="caption" tone="muted">
                  {tr('mobile.diagnostics.title')}
                </Txt>
              </Row>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <LinkAccountSheet choice={flow.linkChoice} flow={flow} />
      {isMock ? <DemoIdentitySheet provider={demoProvider} onClose={() => setDemoProvider(null)} onPick={demoIdentity} /> : null}
    </SafeAreaView>
  );
}

function PasswordForm({ flow, error, setError, disabled }: { flow: ReturnType<typeof useSignInFlow>; error: string | null; setError: (e: string | null) => void; disabled: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    const e = email.trim();
    const errs: typeof fieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(e)) errs.email = tr('auth.validation.email');
    if (!password) errs.password = tr('form.required');
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setError(null);
    log.info('Login attempt', { email: e });
    setError(await flow.run((totp) => authService.login({ email: e, password, ...(totp ? { totp_code: totp } : {}) })));
  };

  return (
    <View style={{ gap: t.spacing.lg }}>
      <TextField
        label={tr('auth.fields.email')}
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        left={<Mail size={18} color={t.colors.textMuted} />}
      />
      <TextField
        ref={passwordRef}
        label={tr('auth.fields.password')}
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        secureTextEntry={!showPassword}
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        left={<Lock size={18} color={t.colors.textMuted} />}
        right={
          <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel="toggle password">
            {showPassword ? <EyeOff size={18} color={t.colors.textMuted} /> : <Eye size={18} color={t.colors.textMuted} />}
          </Pressable>
        }
      />
      {error ? <Notice message={error} /> : null}
      <Button label={flow.busy ? tr('auth.login.submitting') : tr('auth.login.submit')} onPress={submit} loading={flow.busy} disabled={disabled} size="lg" fullWidth />
      <Link href="/(auth)/forgot-password" asChild>
        <Pressable style={{ alignSelf: 'center', padding: t.spacing.sm }} accessibilityRole="link">
          <Row gap={6}>
            <KeyRound size={14} color={t.colors.primary} />
            <Txt tone="primary" variant="caption" style={{ fontWeight: '700' }}>
              {tr('auth.login.forgot_link')}
            </Txt>
          </Row>
        </Pressable>
      </Link>
    </View>
  );
}

/** Authenticator step after `MFA_REQUIRED`, for every sign-in method (the call is repeated with the code). */
function TotpStep({ flow }: { flow: ReturnType<typeof useSignInFlow> }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [totp, setTotp] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!totp.trim()) {
      setFieldError(tr('auth.totp.validation.required'));
      return;
    }
    setFieldError(null);
    setError(await flow.submitTotp(totp.replace(/\s/g, '')));
  };
  return (
    <View style={{ gap: t.spacing.lg }}>
      <TotpField value={totp} onChange={setTotp} error={fieldError} onSubmit={submit} />
      {error ? <Notice message={error} /> : null}
      <Button label={tr('auth.totp.verify_login')} onPress={submit} loading={flow.busy} size="lg" fullWidth />
      <Button label={tr('mobile.auth.totp.back')} variant="ghost" onPress={flow.cancelMfa} disabled={flow.busy} />
      {isMock ? (
        <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {tr('mobile.auth.demo.totp_hint', { email: DEMO.totp, code: DEMO_TOTP_CODE })}
        </Txt>
      ) : null}
    </View>
  );
}

function DemoCard({ onPick, disabled }: { onPick: (who: 'owner' | 'staff') => void; disabled: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Card style={{ gap: t.spacing.md, borderStyle: 'dashed' }}>
      <Txt variant="label" tone="muted">
        {tr('mobile.demo.hint')}
      </Txt>
      <Button label={tr('mobile.demo.owner')} variant="secondary" icon={<UserCog size={18} color={t.colors.primary} />} onPress={() => onPick('owner')} disabled={disabled} />
      <Button label={tr('mobile.demo.staff')} variant="outline" icon={<UserRound size={18} color={t.colors.text} />} onPress={() => onPick('staff')} disabled={disabled} />
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {DEMO.owner} · {DEMO.staff} · {DEMO.password}
      </Txt>
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {tr('mobile.auth.demo.totp_hint', { email: DEMO.totp, code: DEMO_TOTP_CODE })}
      </Txt>
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {tr('mobile.auth.demo.code_hint', { code: DEMO_EMAIL_CODE })}
      </Txt>
    </Card>
  );
}
