import { router } from 'expo-router';
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight } from 'lucide-react-native';
import { View } from 'react-native';

import { ListRow, Txt } from '@/components/ui';
import type { FinanceTransaction } from '@/features/finance/services/finance.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export const accountTypeKey = (type: string) => (type === 'bank' ? 'finance.accounts.type_bank' : 'finance.accounts.type_cash');
export const txnTypeKey = (type: string) => `finance.transactions.type_${type}`;
export const paymentMethodKey = (m: string) => (['cash', 'card', 'transfer', 'other'].includes(m) ? `finance.payment_method.${m}` : null);

export function TxnIcon({ type }: { type: FinanceTransaction['type'] }) {
  const t = useTheme();
  const [bg, fg, Icon] =
    type === 'income'
      ? [t.colors.successBg, t.colors.success, ArrowDownLeft]
      : type === 'expense'
        ? [t.colors.dangerBg, t.colors.danger, ArrowUpRight]
        : [t.colors.infoBg, t.colors.info, ArrowRightLeft];
  return (
    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={18} color={fg} />
    </View>
  );
}

/** One ledger row; `perspective` flips the sign for transfers seen from the counter account. */
export function TransactionRow({ txn, last, perspective }: { txn: FinanceTransaction; last?: boolean; perspective?: string }) {
  const { t: tr, fmt } = useLocale();
  const voided = txn.status === 'void';
  const incoming = txn.type === 'income' || (txn.type === 'transfer' && perspective === txn.counter_account_uuid);
  const sign = txn.type === 'transfer' && !perspective ? '' : incoming ? '+' : '-';
  const title = txn.description || txn.category_name || tr(txnTypeKey(txn.type));
  const sub =
    txn.type === 'transfer'
      ? `${txn.account_name} → ${txn.counter_account_name ?? ''}`
      : [txn.category_name, txn.account_name].filter(Boolean).join(' · ');
  return (
    <ListRow
      title={title}
      subtitle={`${fmt.date(`${txn.transaction_date}T12:00:00`, 'short')} · ${sub}`}
      left={<TxnIcon type={txn.type} />}
      right={
        <Txt
          variant="mono"
          tone={voided ? 'muted' : txn.type === 'transfer' && !perspective ? 'default' : incoming ? 'success' : 'danger'}
          style={voided ? { textDecorationLine: 'line-through' } : undefined}
        >
          {sign}
          {fmt.money(txn.amount, txn.currency)}
        </Txt>
      }
      chevron={false}
      onPress={() => router.push(`/finance/transactions/${txn.uuid}`)}
      last={last}
    />
  );
}
