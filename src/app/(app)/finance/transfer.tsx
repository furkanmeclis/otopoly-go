import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDownUp, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, DateField, EmptyState, ErrorState, Header, IconButton, ListSkeleton, MoneyField, Row, Screen, SelectField, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { financeToday } from '@/features/finance/lib';
import { financeService, type FinanceAccount } from '@/features/finance/services/finance.service';
import { MONEY_KEYS, useFinanceAccounts } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.finance.transfer');

/** Transfer between accounts (web `FinanceTransferDialog`; `?from=` pre-selects the source account). */
export default function TransferScreen() {
  const { t: tr } = useLocale();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const accounts = useFinanceAccounts(true);
  const title = tr('finance.actions.transfer');
  return (
    <RequirePermission gate={{ perm: P.financeWrite, owner: true }} title={title}>
      {accounts.isLoading ? (
        <Screen header={<Header title={title} />}>
          <ListSkeleton rows={5} height={56} />
        </Screen>
      ) : accounts.isError ? (
        <Screen header={<Header title={title} />}>
          <ErrorState description={tr('finance.accounts.error_description')} onRetry={() => accounts.refetch()} />
        </Screen>
      ) : (
        <TransferForm accounts={accounts.data?.items ?? []} presetFrom={from} />
      )}
    </RequirePermission>
  );
}

function TransferForm({ accounts, presetFrom }: { accounts: FinanceAccount[]; presetFrom?: string }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [fromUuid, setFromUuid] = useState(accounts.some((a) => a.uuid === presetFrom) ? presetFrom! : '');
  const [toUuid, setToUuid] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(financeToday());
  const [description, setDescription] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const from = accounts.find((a) => a.uuid === fromUuid);
  const to = accounts.find((a) => a.uuid === toUuid);
  const currencyMismatch = Boolean(from && to && from.currency !== to.currency);

  const save = useApiMutation({
    key: 'finance.transfer.create',
    fn: () =>
      financeService.createTransfer({
        from_account_uuid: fromUuid,
        to_account_uuid: toUuid,
        amount,
        transaction_date: date,
        description: description.trim(),
        ...(referenceNo.trim() ? { reference_no: referenceNo.trim() } : {}),
      }),
    invalidate: MONEY_KEYS,
    success: tr('mobile.finance.transfer_created'),
    onSuccess: (tx) => {
      log.info('transfer created', { uuid: tx.uuid });
      router.back();
    },
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!fromUuid) e.from_account_uuid = tr('finance.transfers.validation.from');
    if (!toUuid) e.to_account_uuid = tr('finance.transfers.validation.to');
    else if (toUuid === fromUuid) e.to_account_uuid = tr('finance.transfers.validation.same_account');
    else if (currencyMismatch) e.to_account_uuid = tr('mobile.finance.currency_mismatch');
    if (!amount || !(Number(amount) > 0)) e.amount = tr('finance.transfers.validation.amount');
    if (!date) e.transaction_date = tr('finance.transactions.validation.date');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  const options = accounts.map((a) => ({ value: a.uuid, label: `${a.name} (${a.currency})`, description: fmt.money(a.current_balance, a.currency) }));

  if (accounts.length < 2) {
    return (
      <Screen header={<Header title={tr('finance.actions.transfer')} />}>
        <EmptyState
          icon={<Wallet size={28} color={t.colors.textMuted} />}
          title={tr('mobile.finance.transfer_need_accounts')}
          description={tr('finance.transfers.form_description')}
          action={<Button label={tr('finance.accounts.title')} onPress={() => router.replace('/finance/accounts')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title={tr('finance.actions.transfer')} subtitle={tr('finance.transfers.form_description')} />}
      footer={<Button label={save.isPending ? tr('common.loading') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" />}
    >
      <Card style={{ gap: t.spacing.md }}>
        <SelectField
          label={tr('finance.transfers.from')}
          placeholder={tr('finance.transactions.select_account')}
          value={fromUuid || null}
          onChange={(v) => setFromUuid(v ?? '')}
          options={options}
          error={errs.from_account_uuid}
          required
        />
        <Row style={{ justifyContent: 'center' }}>
          <IconButton
            label={tr('mobile.finance.swap_accounts')}
            icon={<ArrowDownUp size={18} color={t.colors.primary} />}
            onPress={() => {
              setFromUuid(toUuid);
              setToUuid(fromUuid);
            }}
          />
        </Row>
        <SelectField
          label={tr('finance.transfers.to')}
          placeholder={tr('finance.transactions.select_account')}
          value={toUuid || null}
          onChange={(v) => setToUuid(v ?? '')}
          options={options.filter((o) => o.value !== fromUuid)}
          error={errs.to_account_uuid ?? (currencyMismatch ? tr('mobile.finance.currency_mismatch') : null)}
          required
        />
        {from ? (
          <Txt variant="caption" tone={toNumber(from.current_balance) < toNumber(amount) ? 'warning' : 'muted'}>
            {tr('mobile.finance.available_balance', { amount: fmt.money(from.current_balance, from.currency) })}
          </Txt>
        ) : null}
      </Card>
      <MoneyField label={tr('finance.transactions.amount')} value={amount} onChangeText={setAmount} placeholder="0.00" currency={from?.currency ?? 'TRY'} error={errs.amount} required />
      <DateField label={tr('finance.transactions.date')} value={date} onChange={(v) => setDate(v ?? '')} error={errs.transaction_date} required />
      <View style={{ gap: t.spacing.lg }}>
        <TextField label={tr('finance.transactions.description')} placeholder={tr('finance.transactions.description_placeholder')} value={description} onChangeText={setDescription} multiline error={errs.description} />
        <TextField label={tr('finance.detail.reference_no')} value={referenceNo} onChangeText={setReferenceNo} autoCapitalize="characters" error={errs.reference_no} />
      </View>
    </Screen>
  );
}
