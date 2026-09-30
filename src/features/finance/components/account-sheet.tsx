import { useState } from 'react';
import { View } from 'react-native';

import { Button, MoneyField, Segmented, Sheet, SwitchRow, TextField, Txt } from '@/components/ui';
import { financeService, type FinanceAccount } from '@/features/finance/services/finance.service';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.finance.account-sheet');

/**
 * Create / edit a cash or bank account (web `FinanceAccountDialog`; edit mode uses the backend PATCH
 * fields the web marks as TODO: name, bank, IBAN, notes, default, active).
 */
export function AccountSheet({
  visible,
  onClose,
  account,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  account?: FinanceAccount | null;
  onSaved?: (account: FinanceAccount) => void;
}) {
  if (!visible) return null;
  return <AccountSheetContent onClose={onClose} account={account ?? null} onSaved={onSaved} />;
}

function AccountSheetContent({ onClose, account, onSaved }: { onClose: () => void; account: FinanceAccount | null; onSaved?: (a: FinanceAccount) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const editing = Boolean(account);
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<'cash' | 'bank'>(account?.type ?? 'cash');
  const [currency, setCurrency] = useState(account?.currency ?? 'TRY');
  const [opening, setOpening] = useState('0');
  const [bankName, setBankName] = useState(account?.bank_name ?? '');
  const [iban, setIban] = useState(account?.iban ?? '');
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [isDefault, setIsDefault] = useState(account?.is_default ?? false);
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useApiMutation({
    key: editing ? 'finance.account.update' : 'finance.account.create',
    fn: () => {
      const common = { name: name.trim(), bank_name: bankName.trim(), iban: iban.replace(/\s+/g, '').toUpperCase(), notes: notes.trim(), is_default: isDefault };
      if (account) return financeService.patchAccount(account.uuid, { ...common, is_active: isActive });
      return financeService.createAccount({ ...common, type, currency: currency.trim().toUpperCase(), opening_balance: opening || '0' });
    },
    invalidate: [qk.finance, qk.reports],
    success: editing ? tr('mobile.finance.account_updated') : tr('mobile.finance.account_created'),
    onSuccess: (a) => {
      log.info(editing ? 'account updated' : 'account created', { uuid: a.uuid });
      onSaved?.(a);
      onClose();
    },
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('finance.accounts.validation.name');
    if (!editing && !/^[A-Za-z]{3}$/.test(currency.trim())) e.currency = tr('finance.accounts.validation.currency');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  const showBank = (account?.type ?? type) === 'bank';

  return (
    <Sheet
      visible
      onClose={onClose}
      title={editing ? tr('mobile.finance.edit_account') : tr('finance.accounts.create')}
      footer={<Button label={save.isPending ? tr('common.loading') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" />}
    >
      <Txt variant="caption" tone="secondary">
        {editing ? tr('mobile.finance.edit_account_description') : tr('finance.accounts.create_description')}
      </Txt>
      <TextField label={tr('finance.accounts.name')} value={name} onChangeText={setName} error={errs.name} required autoFocus={!editing} />
      {!editing ? (
        <>
          <View style={{ gap: 6 }}>
            <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
              {tr('finance.accounts.type')}
            </Txt>
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'cash', label: tr('finance.accounts.type_cash') },
                { value: 'bank', label: tr('finance.accounts.type_bank') },
              ]}
            />
          </View>
          <TextField
            label={tr('finance.accounts.currency')}
            value={currency}
            onChangeText={(v) => setCurrency(v.toUpperCase())}
            maxLength={3}
            autoCapitalize="characters"
            placeholder="TRY"
            error={errs.currency}
            required
          />
          <MoneyField label={tr('finance.accounts.opening_balance')} value={opening} onChangeText={setOpening} placeholder="0.00" currency={currency || 'TRY'} error={errs.opening_balance} />
        </>
      ) : null}
      {showBank ? (
        <>
          <TextField label={tr('finance.accounts.bank_name')} value={bankName} onChangeText={setBankName} error={errs.bank_name} />
          <TextField label={tr('finance.accounts.iban')} value={iban} onChangeText={setIban} autoCapitalize="characters" autoCorrect={false} error={errs.iban} />
        </>
      ) : null}
      {editing ? <TextField label={tr('finance.accounts.notes')} value={notes} onChangeText={setNotes} multiline /> : null}
      <View style={{ gap: t.spacing.sm }}>
        <SwitchRow label={tr('finance.accounts.is_default')} description={tr('mobile.finance.default_hint')} value={isDefault} onValueChange={setIsDefault} />
        {editing ? <SwitchRow label={tr('finance.accounts.is_active')} value={isActive} onValueChange={setIsActive} disabled={account?.is_default && isDefault} /> : null}
      </View>
    </Sheet>
  );
}
