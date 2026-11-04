import { router, useLocalSearchParams } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, DateField, EmptyState, ErrorState, FilterChips, Header, ListSkeleton, MoneyField, Screen, Segmented, SelectField, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { financeToday, PAYMENT_METHODS } from '@/features/finance/lib';
import { financeService, type FinanceAccount } from '@/features/finance/services/finance.service';
import { MONEY_KEYS, useFinanceAccounts, useFinanceCategories } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.finance.transaction-new');

type TxType = 'income' | 'expense';
type Method = (typeof PAYMENT_METHODS)[number];

/** Income / expense entry (web `FinanceTransactionDialog`, reached via `?type=income|expense`, optional `?account=`). */
export default function NewTransactionScreen() {
  const { t: tr } = useLocale();
  const params = useLocalSearchParams<{ type?: string; account?: string }>();
  const type: TxType = params.type === 'expense' ? 'expense' : 'income';
  const accounts = useFinanceAccounts(true);
  const title = type === 'income' ? tr('finance.actions.add_income') : tr('finance.actions.add_expense');

  return (
    <RequirePermission gate={{ perm: P.financeWrite, owner: true }} title={title}>
      {accounts.isLoading ? (
        <Screen header={<Header title={title} />}>
          <ListSkeleton rows={5} height={56} />
        </Screen>
      ) : accounts.isError ? (
        <Screen header={<Header title={title} />}>
          <ErrorState error={accounts.error} description={tr('finance.accounts.error_description')} onRetry={() => accounts.refetch()} />
        </Screen>
      ) : (
        <TransactionForm initialType={type} accounts={accounts.data?.items ?? []} presetAccount={params.account} />
      )}
    </RequirePermission>
  );
}

function TransactionForm({ initialType, accounts, presetAccount }: { initialType: TxType; accounts: FinanceAccount[]; presetAccount?: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [type, setType] = useState<TxType>(initialType);
  const defaultAccount = accounts.find((a) => a.uuid === presetAccount)?.uuid ?? accounts.find((a) => a.is_default)?.uuid ?? accounts[0]?.uuid ?? '';
  const [accountUuid, setAccountUuid] = useState(defaultAccount);
  const [categoryUuid, setCategoryUuid] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(financeToday());
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [referenceNo, setReferenceNo] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const categories = useFinanceCategories(type);
  const categoryItems = (categories.data?.items ?? []).filter((c) => c.is_active);
  const account = accounts.find((a) => a.uuid === accountUuid);

  const save = useApiMutation({
    key: 'finance.transaction.create',
    fn: () =>
      financeService.createTransaction({
        type,
        account_uuid: accountUuid,
        amount,
        transaction_date: date,
        description: description.trim(),
        payment_method: method,
        ...(categoryUuid ? { category_uuid: categoryUuid } : {}),
        ...(referenceNo.trim() ? { reference_no: referenceNo.trim() } : {}),
      }),
    invalidate: MONEY_KEYS,
    success: tr('mobile.finance.transaction_created'),
    onSuccess: (tx) => {
      log.info('transaction created', { uuid: tx.uuid, type: tx.type });
      router.back();
    },
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!accountUuid) e.account_uuid = tr('finance.transactions.validation.account');
    if (!amount || !(Number(amount) > 0)) e.amount = tr('finance.transactions.validation.amount');
    if (!date) e.transaction_date = tr('finance.transactions.validation.date');
    if (type === 'expense' && !categoryUuid) e.category_uuid = tr('finance.transactions.validation.category');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  const title = type === 'income' ? tr('finance.actions.add_income') : tr('finance.actions.add_expense');

  if (accounts.length === 0) {
    return (
      <Screen header={<Header title={title} />}>
        <EmptyState
          icon={<Wallet size={28} color={t.colors.textMuted} />}
          title={tr('finance.summary.no_accounts')}
          description={tr('finance.summary.no_accounts_description')}
          action={<Button label={tr('finance.accounts.title')} onPress={() => router.replace('/finance/accounts')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title={title} subtitle={tr('finance.transactions.form_description')} />}
      footer={<Button label={save.isPending ? tr('common.loading') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" variant={type === 'income' ? 'success' : 'primary'} />}
    >
      <Segmented<TxType>
        value={type}
        onChange={(v) => {
          setType(v);
          setCategoryUuid('');
          setLocalErrors({});
        }}
        options={[
          { value: 'income', label: tr('finance.transactions.type_income') },
          { value: 'expense', label: tr('finance.transactions.type_expense') },
        ]}
      />
      <MoneyField label={tr('finance.transactions.amount')} value={amount} onChangeText={setAmount} placeholder="0.00" currency={account?.currency ?? 'TRY'} error={errs.amount} required autoFocus />
      <SelectField
        label={tr('finance.transactions.account')}
        placeholder={tr('finance.transactions.select_account')}
        value={accountUuid || null}
        onChange={(v) => setAccountUuid(v ?? '')}
        options={accounts.map((a) => ({ value: a.uuid, label: `${a.name} (${a.currency})`, description: a.is_default ? tr('finance.accounts.default') : undefined }))}
        error={errs.account_uuid}
        required
      />
      <View style={{ gap: 6 }}>
        <SelectField
          label={tr('finance.transactions.category')}
          placeholder={tr('finance.transactions.select_category')}
          value={categoryUuid || null}
          onChange={(v) => setCategoryUuid(v ?? '')}
          options={categoryItems.map((c) => ({ value: c.uuid, label: c.name }))}
          loading={categories.isLoading}
          allowClear={type === 'income'}
          searchable={categoryItems.length > 8}
          error={errs.category_uuid}
          required={type === 'expense'}
        />
        {!categories.isLoading && categoryItems.length === 0 ? (
          <Pressable onPress={() => router.push('/finance/categories')} accessibilityRole="link">
            <Txt variant="caption" tone="primary">
              {type === 'expense' ? tr('finance.categories.empty_expense_description') : tr('finance.categories.empty_income_description')}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <DateField label={tr('finance.transactions.date')} value={date} onChange={(v) => setDate(v ?? '')} error={errs.transaction_date} required />
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('finance.detail.payment_method')}
        </Txt>
        <FilterChips<Method> value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: tr(`finance.payment_method.${m}`) }))} />
      </View>
      <TextField label={tr('finance.transactions.description')} placeholder={tr('finance.transactions.description_placeholder')} value={description} onChangeText={setDescription} multiline error={errs.description} />
      <TextField label={tr('finance.detail.reference_no')} value={referenceNo} onChangeText={setReferenceNo} autoCapitalize="characters" error={errs.reference_no} />
    </Screen>
  );
}
