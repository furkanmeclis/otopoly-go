import { router } from 'expo-router';
import { CheckCircle2, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { isApiError } from '@/api/errors';
import { Button, Header, Screen, TextField, Txt } from '@/components/ui';
import { authService } from '@/features/account/services/auth.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.forgot');

export default function ForgotPasswordScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(tr('auth.validation.email'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authService.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // The API answers the same way whether or not the account exists; only transport errors surface.
      log.warn('Forgot password failed', isApiError(err) ? err.code : err);
      setError(isApiError(err) && err.code === 'RATE_LIMITED' ? tr('auth.login.rate_limited') : tr('common.error_generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen header={<Header title={tr('auth.forgot.title')} />}>
      {sent ? (
        <View style={{ alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.xxxl }}>
          <CheckCircle2 size={48} color={t.colors.success} />
          <Txt variant="heading">{tr('auth.forgot.success')}</Txt>
          <Txt tone="secondary" style={{ textAlign: 'center' }}>
            {tr('auth.forgot.success_body')}
          </Txt>
          <Button label={tr('common.back')} variant="outline" onPress={() => router.back()} />
        </View>
      ) : (
        <View style={{ gap: t.spacing.lg }}>
          <Txt tone="secondary">{tr('auth.forgot.description')}</Txt>
          <TextField
            label={tr('auth.fields.email')}
            value={email}
            onChangeText={setEmail}
            error={error}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            autoFocus
            returnKeyType="send"
            onSubmitEditing={submit}
            left={<Mail size={18} color={t.colors.textMuted} />}
          />
          <Button label={tr('auth.forgot.submit')} onPress={submit} loading={loading} size="lg" />
        </View>
      )}
    </Screen>
  );
}
