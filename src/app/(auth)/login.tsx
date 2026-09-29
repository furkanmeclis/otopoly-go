import { Link, router } from 'expo-router';
import { Bug, Car, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, UserCog, UserRound } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '@/api/errors';
import { Button, Card, Row, TextField, Txt } from '@/components/ui';
import { isMock } from '@/config/env';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.login');
const DEMO = { owner: 'demo@otopoly.com', staff: 'personel@otopoly.com', password: 'demo1234' };

export default function LoginScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; totp?: string }>({});
  const passwordRef = useRef<TextInput>(null);

  const submit = async (overrideEmail?: string, overridePassword?: string) => {
    const e = (overrideEmail ?? email).trim();
    const p = overridePassword ?? password;
    const errs: typeof fieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(e)) errs.email = tr('auth.validation.email');
    if (!p) errs.password = tr('form.required');
    if (needsTotp && !totp.trim()) errs.totp = tr('form.required');
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    setError(null);
    try {
      await login(e, p, needsTotp ? totp.trim() : undefined);
    } catch (err) {
      const code = isApiError(err) ? err.code : 'UNKNOWN';
      log.warn('Login failed', { code });
      if (code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        return;
      }
      setError(
        code === 'INVALID_CREDENTIALS'
          ? tr('auth.login.error')
          : code === 'RATE_LIMITED'
            ? tr('auth.login.rate_limited')
            : code === 'NO_TENANT_MEMBERSHIP'
              ? tr('auth.login.no_tenant_membership')
              : code === 'NETWORK_ERROR' || code === 'TIMEOUT'
                ? tr('mobile.error.network')
                : tr('common.error_generic'),
      );
    } finally {
      setLoading(false);
    }
  };

  const demo = (who: 'owner' | 'staff') => {
    setEmail(DEMO[who]);
    setPassword(DEMO.password);
    submit(DEMO[who], DEMO.password);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: t.spacing.xxl, gap: t.spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: t.spacing.md }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                backgroundColor: t.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                ...t.shadow.md,
              }}
            >
              <Car size={36} color={t.colors.onPrimary} />
            </View>
            <Txt variant="display">Otopoly</Txt>
            <Txt tone="secondary" style={{ textAlign: 'center' }}>
              {needsTotp ? tr('auth.totp.login_description') : tr('organizations.login.description')}
            </Txt>
          </View>

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
              editable={!needsTotp}
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
              onSubmitEditing={() => submit()}
              left={<Lock size={18} color={t.colors.textMuted} />}
              editable={!needsTotp}
              right={
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel="toggle password">
                  {showPassword ? <EyeOff size={18} color={t.colors.textMuted} /> : <Eye size={18} color={t.colors.textMuted} />}
                </Pressable>
              }
            />
            {needsTotp ? (
              <TextField
                label={tr('auth.totp.login_title')}
                value={totp}
                onChangeText={setTotp}
                error={fieldErrors.totp}
                placeholder={tr('auth.totp.code_placeholder')}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                autoFocus
                left={<ShieldCheck size={18} color={t.colors.textMuted} />}
              />
            ) : null}

            {error ? (
              <View style={{ backgroundColor: t.colors.dangerBg, borderRadius: t.radius.md, padding: t.spacing.md }} accessibilityLiveRegion="polite">
                <Txt tone="danger" variant="caption" style={{ fontWeight: '600' }}>
                  {error}
                </Txt>
              </View>
            ) : null}

            <Button
              label={needsTotp ? tr('auth.totp.verify_login') : loading ? tr('auth.login.submitting') : tr('auth.login.submit')}
              onPress={() => submit()}
              loading={loading}
              size="lg"
              fullWidth
            />
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

          {isMock ? (
            <Card style={{ gap: t.spacing.md, borderStyle: 'dashed' }}>
              <Txt variant="label" tone="muted">
                {tr('mobile.demo.hint')}
              </Txt>
              <Button label={tr('mobile.demo.owner')} variant="secondary" icon={<UserCog size={18} color={t.colors.primary} />} onPress={() => demo('owner')} disabled={loading} />
              <Button label={tr('mobile.demo.staff')} variant="outline" icon={<UserRound size={18} color={t.colors.text} />} onPress={() => demo('staff')} disabled={loading} />
              <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                {DEMO.owner} · {DEMO.staff} · {DEMO.password}
              </Txt>
            </Card>
          ) : null}

          <Pressable onPress={() => router.push('/diagnostics')} style={{ alignSelf: 'center', padding: t.spacing.sm }} accessibilityRole="button" accessibilityLabel={tr('mobile.diagnostics.title')}>
            <Row gap={6}>
              <Bug size={14} color={t.colors.textMuted} />
              <Txt variant="caption" tone="muted">
                {tr('mobile.diagnostics.title')}
              </Txt>
            </Row>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
