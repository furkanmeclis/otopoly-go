/**
 * Cari entry sheets — web `ChargeDialog`, `PaymentDialog`, `AdjustmentDialog` (cari-detail-page).
 * Owner-only writes; the caller only renders them when the gate passes.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, DateField, MoneyField, Segmented, SelectField, Sheet, TextField, Txt } from '@/components/ui';
import { cariService, type AdjustmentInput, type ChargeInput, type PaymentInput } from '@/features/cari/services/cari.service';
import { localToday } from '@/features/jobs/lib/job-ui';
import { MONEY_KEYS, useFinanceAccounts } from '@/features/queries';
import { defaultAccountUuid } from '@/features/sales/components/commerce-parts';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

const log = createLogger('screen.cari_detail');

export type CariSheetKind = 'charge' | 'payment' | 'adjustment';
const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];
type Direction = AdjustmentInput['direction'];

type Props = { accountUuid: string; kind: CariSheetKind | null; onClose: () => void };

/** One sheet host so each open starts from a fresh form (keyed by kind). */
export function CariEntrySheet({ accountUuid, kind, onClose }: Props) {
  if (!kind) return null;
  return <EntryForm key={kind} accountUuid={accountUuid} kind={kind} onClose={onClose} />;
}

function EntryForm({ accountUuid, kind, onClose }: { accountUuid: string; kind: CariSheetKind; onClose: () => void }) {
  const { t: tr, fmt } = useLocale();
  const accountsQuery = useFinanceAccounts(true);
  const accounts = useMemo(() => accountsQuery.data?.items ?? [], [accountsQuery.data]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(localToday());
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [direction, setDirection] = useState<Direction>('increase');
  const [picked, setPicked] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const account = picked ?? defaultAccountUuid(accounts);

  const toastKey = kind === 'charge' ? 'cari.toast.charge' : kind === 'payment' ? 'cari.toast.payment' : 'cari.toast.adjustment';
  const save = useApiMutation({
    key: `cari.${kind}`,
    fn: () => {
      const base = { amount, entry_date: date!, description: description.trim() || undefined };
      if (kind === 'charge') return cariService.charge(accountUuid, base satisfies ChargeInput);
      if (kind === 'payment') return cariService.payment(accountUuid, { ...base, finance_account_uuid: account!, payment_method: method } satisfies PaymentInput);
      return cariService.adjustment(accountUuid, { ...base, direction } satisfies AdjustmentInput);
    },
    invalidate: MONEY_KEYS,
    success: tr(toastKey),
    onSuccess: (entry) => {
      log.info(`cari ${kind} posted`, { account: accountUuid, entry: entry.uuid });
      onClose();
    },
  });
  const errs = { ...fieldErrors(save.error), ...local };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!amount || !(toNumber(amount) > 0)) e.amount = tr('cari.validation.amount');
    if (!date) e.entry_date = tr('cari.validation.date');
    if (kind === 'payment' && !account) e.finance_account_uuid = tr('cari.validation.finance_account');
    setLocal(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  const title = tr(`cari.actions.${kind}`);
  const description_ = tr(`cari.${kind}.description`);

  return (
    <Sheet visible onClose={onClose} title={title} footer={<Button size="lg" label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={submit} />}>
      <Txt tone="secondary">{description_}</Txt>
      {kind === 'adjustment' ? (
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('cari.adjustment.direction')}
          </Txt>
          <Segmented<Direction>
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'increase', label: tr('cari.adjustment.increase') },
              { value: 'decrease', label: tr('cari.adjustment.decrease') },
            ]}
          />
        </View>
      ) : null}
      {kind === 'payment' ? (
        <SelectField
          label={tr('cari.finance_account')}
          placeholder={tr('cari.payment.select_account')}
          value={account}
          onChange={setPicked}
          loading={accountsQuery.isLoading}
          error={errs.finance_account_uuid}
          required
          options={accounts.map((a) => ({ value: a.uuid, label: `${a.name} (${a.currency})`, description: fmt.money(a.current_balance, a.currency) }))}
        />
      ) : null}
      <MoneyField label={tr('cari.amount')} placeholder="0.00" value={amount} onChangeText={setAmount} error={errs.amount} required />
      <DateField label={tr('cari.entry_date')} value={date} onChange={setDate} error={errs.entry_date} required />
      {kind === 'payment' ? (
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('cari.payment_method')}
          </Txt>
          <Segmented<PaymentMethod> value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => ({ value: m, label: tr(`cari.payment_method.${m}`) }))} />
        </View>
      ) : null}
      <TextField label={tr('cari.entry_description')} value={description} onChangeText={setDescription} multiline error={errs.description} />
    </Sheet>
  );
}
