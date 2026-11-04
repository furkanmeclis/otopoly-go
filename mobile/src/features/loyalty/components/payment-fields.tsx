import { useMemo } from 'react';
import { View } from 'react-native';

import { SelectField, Segmented, Txt } from '@/components/ui';
import { useFinanceAccounts } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';

import type { PaymentInput, PaymentMethod } from '../types';

export type PaymentState = { method: PaymentMethod; account: string | null };

export const initialPayment: PaymentState = { method: 'cash', account: null };

/** Default account for a method: cash → default cash drawer, card → default bank / POS (like CloseJobSheet). */
export function useDefaultAccount(method: PaymentMethod) {
  const accounts = useFinanceAccounts(true);
  const items = useMemo(() => accounts.data?.items ?? [], [accounts.data]);
  const want = method === 'card' ? 'bank' : 'cash';
  const fallback = (items.find((a) => a.type === want && a.is_default) ?? items.find((a) => a.type === want) ?? items.find((a) => a.is_default) ?? items[0])?.uuid ?? null;
  return { items, fallback };
}

/** Body for the API; null when cash / card has no account (the form shows the error). */
export function paymentBody(state: PaymentState, fallback: string | null): PaymentInput | null {
  if (state.method === 'cari') return { method: 'cari' };
  const account = state.account ?? fallback;
  return account ? { method: state.method, finance_account_uuid: account } : null;
}

/** Cash / card / cari with the finance account picker (web `payment-fields.tsx`). */
export function PaymentFields({ value, onChange, error }: { value: PaymentState; onChange: (v: PaymentState) => void; error?: string | null }) {
  const { t: tr, fmt } = useLocale();
  const { items, fallback } = useDefaultAccount(value.method);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('loyalty.fields.method')}
        </Txt>
        <Segmented<PaymentMethod>
          value={value.method}
          onChange={(m) => onChange({ method: m, account: null })}
          options={(['cash', 'card', 'cari'] as const).map((m) => ({ value: m, label: tr(`loyalty.method.${m}`) }))}
        />
      </View>
      {value.method === 'cari' ? (
        <Txt variant="caption" tone="secondary">
          {tr('loyalty.fields.cari_hint')}
        </Txt>
      ) : (
        <SelectField
          label={tr('loyalty.fields.finance_account')}
          placeholder={tr('loyalty.fields.pick_account')}
          value={value.account ?? fallback}
          onChange={(v) => onChange({ ...value, account: v })}
          error={error}
          required
          options={items.map((a) => ({ value: a.uuid, label: a.name, description: fmt.money(a.current_balance, a.currency) }))}
        />
      )}
    </View>
  );
}
