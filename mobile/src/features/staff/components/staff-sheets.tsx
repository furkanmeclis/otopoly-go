import { useState } from 'react';

import { Button, Sheet, TextField, Txt } from '@/components/ui';
import { qk } from '@/features/queries';
import { staffService, type StaffMember } from '@/features/staff/services/staff.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

const log = createLogger('screen.staff');

/** Backend `password.ValidatePassword` (the web form only checks length; the API enforces all of it). */
export function passwordPolicyError(tr: (k: string) => string, value: string): string | null {
  if (value.length < 8) return tr('staff.validation.password');
  if (!/[A-Z]/.test(value)) return tr('auth.validation.password_upper');
  if (!/[a-z]/.test(value)) return tr('auth.validation.password_lower');
  if (!/[0-9]/.test(value)) return tr('auth.validation.password_digit');
  return null;
}

/** Web staff "create" dialog: name, surname, e-mail, initial password. */
export function StaffCreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return visible ? <CreateForm onClose={onClose} /> : null;
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const { t: tr } = useLocale();
  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const create = useApiMutation({
    key: 'staff.create',
    fn: () => staffService.create({ name: name.trim(), surname: surname.trim(), email: email.trim(), password }),
    invalidate: [qk.staff, qk.billing],
    success: tr('staff.toast.created'),
    onSuccess: (m) => {
      log.info('Staff created', { uuid: m.uuid });
      onClose();
    },
  });
  const errs = { ...fieldErrors(create.error), ...local };
  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('staff.validation.name');
    if (!surname.trim()) e.surname = tr('staff.validation.surname');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = tr('staff.validation.email');
    const pw = passwordPolicyError(tr, password);
    if (pw) e.password = pw;
    setLocal(e);
    if (!Object.keys(e).length) create.mutate(undefined);
  };
  return (
    <Sheet visible onClose={onClose} title={tr('staff.create.title')} footer={<Button size="lg" label={tr('staff.actions.create')} loading={create.isPending} onPress={submit} />}>
      <Txt variant="caption" tone="secondary">
        {tr('staff.create.description')}
      </Txt>
      <TextField label={tr('staff.name')} value={name} onChangeText={setName} error={errs.name} autoComplete="given-name" required autoFocus />
      <TextField label={tr('staff.surname')} value={surname} onChangeText={setSurname} error={errs.surname} autoComplete="family-name" required />
      <TextField label={tr('staff.email')} value={email} onChangeText={setEmail} error={errs.email} keyboardType="email-address" autoCapitalize="none" autoComplete="off" required />
      <TextField label={tr('staff.password')} value={password} onChangeText={setPassword} error={errs.password} secureTextEntry autoComplete="new-password" hint={tr('auth.placeholders.new_password')} required />
    </Sheet>
  );
}

/** Web staff "reset password" dialog. */
export function ResetPasswordSheet({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  return member ? <ResetForm key={member.uuid} member={member} onClose={onClose} /> : null;
}

function ResetForm({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const { t: tr } = useLocale();
  const [password, setPassword] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const reset = useApiMutation({
    key: 'staff.reset_password',
    fn: () => staffService.resetPassword(member.uuid, { password }),
    success: tr('staff.toast.password_reset'),
    onSuccess: onClose,
  });
  const submit = () => {
    const e = passwordPolicyError(tr, password);
    setLocal(e);
    if (!e) reset.mutate(undefined);
  };
  return (
    <Sheet visible onClose={onClose} title={tr('staff.reset.title')} footer={<Button size="lg" label={tr('staff.actions.reset_password')} loading={reset.isPending} onPress={submit} />}>
      <Txt tone="secondary">{`${member.name} ${member.surname}`}</Txt>
      <TextField label={tr('staff.password')} value={password} onChangeText={setPassword} error={local ?? fieldErrors(reset.error).password} secureTextEntry autoComplete="new-password" hint={tr('auth.placeholders.new_password')} autoFocus />
    </Sheet>
  );
}
