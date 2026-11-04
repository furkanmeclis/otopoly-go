/** Connect / edit an SMS provider and send a test SMS (web `sms-provider-dialog.tsx`, `sms-test-dialog.tsx`). */
import { Send } from 'lucide-react-native';
import { useState } from 'react';

import { Badge, Button, Sheet, SwitchRow, TextField, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

import { useSmsMutations } from '../queries';
import type { SmsProviderCode, SmsProviderEntry } from '../services/sms.service';
import { SmsSegmentCounter } from './sms-segment-counter';

/** i18n keys per provider / field / sender kind (literal so check-i18n can verify them). */
export const PROVIDER_KEYS: Record<SmsProviderCode, { name: string; subtitle: string; description: string; formHint: string }> = {
  netgsm: {
    name: 'mobile.messaging.sms.providers.netgsm.name',
    subtitle: 'mobile.messaging.sms.providers.netgsm.subtitle',
    description: 'mobile.messaging.sms.providers.netgsm.description',
    formHint: 'mobile.messaging.sms.providers.netgsm.form_hint',
  },
  twilio: {
    name: 'mobile.messaging.sms.providers.twilio.name',
    subtitle: 'mobile.messaging.sms.providers.twilio.subtitle',
    description: 'mobile.messaging.sms.providers.twilio.description',
    formHint: 'mobile.messaging.sms.providers.twilio.form_hint',
  },
};
export const FIELD_KEYS: Record<string, { label: string; hint: string }> = {
  usercode: { label: 'mobile.messaging.sms.fields.usercode', hint: 'mobile.messaging.sms.fields.usercode_hint' },
  password: { label: 'mobile.messaging.sms.fields.password', hint: 'mobile.messaging.sms.fields.password_hint' },
  account_sid: { label: 'mobile.messaging.sms.fields.account_sid', hint: 'mobile.messaging.sms.fields.account_sid_hint' },
  auth_token: { label: 'mobile.messaging.sms.fields.auth_token', hint: 'mobile.messaging.sms.fields.auth_token_hint' },
};
export const SENDER_KEYS = {
  msgheader: { label: 'mobile.messaging.sms.sender.msgheader', hint: 'mobile.messaging.sms.sender.msgheader_hint' },
  from: { label: 'mobile.messaging.sms.sender.from', hint: 'mobile.messaging.sms.sender.from_hint' },
} as const;

export function SmsProviderSheet({ entry, otherActive, onClose }: { entry: SmsProviderEntry | null; otherActive: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  const title = entry
    ? tr(entry.account ? 'mobile.messaging.sms.form.edit_title' : 'mobile.messaging.sms.form.connect_title', { provider: tr(PROVIDER_KEYS[entry.provider].name) })
    : '';
  return (
    <Sheet visible={Boolean(entry)} onClose={onClose} title={title}>
      {entry ? <ProviderForm key={entry.provider} entry={entry} otherActive={otherActive} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ProviderForm({ entry, otherActive, onClose }: { entry: SmsProviderEntry; otherActive: boolean; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { save } = useSmsMutations();
  const account = entry.account;
  const editing = Boolean(account);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(entry.fields.map((f) => [f.key, ''])));
  const [sender, setSender] = useState(account?.sender ?? '');
  const [activate, setActivate] = useState(account ? account.is_active : !otherActive);
  const [touched, setTouched] = useState(false);
  const errs = fieldErrors(save.error);

  // Editing: an empty field keeps the stored (encrypted) value; a new account needs every required field.
  const missing = (key: string, required: boolean) => touched && required && !editing && !values[key]?.trim();
  const valid = sender.trim().length > 0 && sender.trim().length <= 64 && entry.fields.every((f) => !f.required || editing || values[f.key]?.trim());

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    const credentials: Record<string, string> = {};
    for (const f of entry.fields) {
      const v = values[f.key]?.trim();
      if (v) credentials[f.key] = v;
    }
    save.mutate({ provider: entry.provider, body: { credentials, sender: sender.trim(), activate } }, { onSuccess: onClose });
  };

  return (
    <>
      <Txt variant="caption" tone="secondary">
        {tr(PROVIDER_KEYS[entry.provider].formHint)}
      </Txt>
      {entry.fields.map((f) => {
        const hint = account?.credential_hints?.[f.key];
        const keys = FIELD_KEYS[f.key];
        return (
          <TextField
            key={f.key}
            label={keys ? tr(keys.label) : f.key}
            hint={keys ? tr(keys.hint) : undefined}
            required={f.required && !editing}
            value={values[f.key]}
            onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            secureTextEntry={f.secret}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType={f.secret ? 'password' : 'none'}
            placeholder={editing ? tr('mobile.messaging.sms.form.keep_placeholder') : undefined}
            error={missing(f.key, f.required) ? tr('mobile.messaging.sms.form.required') : errs[f.key]}
            right={hint ? <Badge size="sm" label={hint} /> : undefined}
            accessibilityHint={hint ? tr('mobile.messaging.sms.hint_set', { hint }) : undefined}
          />
        );
      })}
      <TextField
        label={tr(SENDER_KEYS[entry.sender_kind].label)}
        hint={tr(SENDER_KEYS[entry.sender_kind].hint)}
        required
        value={sender}
        onChangeText={setSender}
        maxLength={64}
        autoCapitalize={entry.sender_kind === 'msgheader' ? 'characters' : 'none'}
        autoCorrect={false}
        placeholder={entry.sender_kind === 'from' ? '+15005550006' : 'FIRMA'}
        error={touched && !sender.trim() ? tr('mobile.messaging.sms.form.required') : errs.sender}
      />
      <SwitchRow
        label={tr('mobile.messaging.sms.form.activate')}
        description={otherActive ? tr('mobile.messaging.sms.form.activate_switch_hint') : tr('mobile.messaging.sms.form.activate_hint')}
        value={activate}
        onValueChange={setActivate}
      />
      <Button
        size="lg"
        label={editing ? tr('mobile.messaging.sms.form.save') : tr('mobile.messaging.sms.form.connect')}
        loading={save.isPending}
        onPress={submit}
        style={{ marginTop: t.spacing.sm }}
      />
    </>
  );
}

export function SmsTestSheet({ provider, onClose }: { provider: SmsProviderCode | null; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={Boolean(provider)} onClose={onClose} title={provider ? tr('mobile.messaging.sms.test.title', { provider: tr(PROVIDER_KEYS[provider].name) }) : ''}>
      {provider ? <TestForm key={provider} provider={provider} onClose={onClose} /> : null}
    </Sheet>
  );
}

function TestForm({ provider, onClose }: { provider: SmsProviderCode; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { sendTest } = useSmsMutations();
  const [phone, setPhone] = useState('');
  const [body, setBody] = useState(() => tr('mobile.messaging.sms.test.default_body'));
  const errs = fieldErrors(sendTest.error);
  return (
    <>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.messaging.sms.test.description')}
      </Txt>
      <TextField
        label={tr('mobile.messaging.sms.test.phone')}
        hint={tr('mobile.messaging.sms.test.phone_hint')}
        value={phone}
        onChangeText={setPhone}
        placeholder="0532 123 45 67"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        error={errs.phone}
        required
      />
      <TextField label={tr('mobile.messaging.sms.test.body')} value={body} onChangeText={setBody} multiline maxLength={1000} />
      <SmsSegmentCounter body={body} provider={provider} />
      <Button
        size="lg"
        label={tr('mobile.messaging.sms.test.send')}
        icon={<Send size={18} color={t.colors.onPrimary} />}
        loading={sendTest.isPending}
        disabled={!phone.trim() || !body.trim()}
        onPress={() =>
          sendTest.mutate(
            { provider, phone: phone.trim(), body: body.trim() },
            {
              onSuccess: (res) => {
                if (res.status === 'sent') onClose();
              },
            },
          )
        }
      />
    </>
  );
}
