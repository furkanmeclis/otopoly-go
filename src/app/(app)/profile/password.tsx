import { useState } from 'react';

import { Button, Header, Screen, TextField, Txt } from '@/components/ui';
import { authService } from '@/features/account/services/auth.service';
import { useAuth } from '@/features/auth/auth-provider';
import { passwordPolicyError } from '@/features/staff/components/staff-sheets';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

const log = createLogger('screen.profile.password');

/** Web `ChangePasswordForm`: current + new (policy) + confirm; success signs the user out (all sessions are revoked). */
export default function ChangePasswordScreen() {
  const { t: tr } = useLocale();
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});

  const change = useApiMutation({
    key: 'account.password.change',
    fn: () => authService.changePassword({ current_password: current, new_password: next }),
    success: tr('auth.password.success'),
    onSuccess: () => {
      log.info('Password changed, signing out');
      logout().catch((error) => log.warn('Logout after password change failed', error));
    },
  });
  const errs = { ...fieldErrors(change.error), ...local };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!current) e.current_password = tr('auth.validation.password_required');
    const policy = next ? passwordPolicyError(tr, next) : tr('auth.validation.password_required');
    if (policy) e.new_password = next.length < 8 && next ? tr('auth.validation.password_min') : policy;
    if (!confirmPw) e.confirm_password = tr('auth.validation.confirm_required');
    else if (confirmPw !== next) e.confirm_password = tr('auth.validation.password_mismatch');
    setLocal(e);
    if (!Object.keys(e).length) change.mutate(undefined);
  };

  return (
    <Screen
      header={<Header title={tr('auth.password.title')} subtitle={tr('auth.profile.change_password_body')} />}
      footer={<Button size="lg" label={change.isPending ? tr('auth.password.submitting') : tr('auth.password.submit')} loading={change.isPending} onPress={submit} />}
    >
      <Txt tone="secondary">{tr('auth.password.description')}</Txt>
      <TextField label={tr('auth.fields.current_password')} placeholder={tr('auth.placeholders.password')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" error={errs.current_password} required />
      <TextField label={tr('auth.fields.new_password')} placeholder={tr('auth.placeholders.new_password')} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={errs.new_password} required />
      <TextField label={tr('auth.fields.confirm_password')} placeholder={tr('auth.placeholders.confirm_password')} value={confirmPw} onChangeText={setConfirmPw} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={errs.confirm_password} required onSubmitEditing={submit} />
    </Screen>
  );
}
