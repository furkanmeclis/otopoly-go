import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { ScrollText } from 'lucide-react-native';

import { EmptyState, ErrorState, FilterChips, ListSkeleton, Section } from '@/components/ui';
import { TransactionRow } from '@/features/finance/components/finance-parts';
import { TX_TYPES } from '@/features/finance/lib';
import { useTransactionsInfinite } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type TypeFilter = 'all' | (typeof TX_TYPES)[number];
type StatusFilter = 'all' | 'posted' | 'void';

/**
 * Full-screen list: detail content on top, then the paginated ledger (web `FinanceLedgerSection`:
 * type + status filters, newest first, rows open the transaction report).
 */
export function LedgerList({
  scope,
  perspective,
  title,
  header,
  onRefresh,
}: {
  scope: { account_uuid?: string; category_uuid?: string };
  /** Account uuid whose point of view signs transfer amounts. */
  perspective?: string;
  title: string;
  header: ReactNode;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const list = useTransactionsInfinite({
    ...scope,
    type: type === 'all' ? undefined : type,
    status: status === 'all' ? undefined : status,
    sort: '-transaction_date,-created_at',
  });
  const count = list.items.length;

  return (
    <FlatList
      data={list.items}
      keyExtractor={(x) => x.uuid}
      contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
      ListHeaderComponent={
        <View style={{ gap: t.spacing.lg, paddingBottom: t.spacing.md }}>
          {header}
          <Section title={list.total ? `${title} · ${list.total}` : title}>
            <FilterChips<TypeFilter>
              value={type}
              onChange={setType}
              options={[{ value: 'all', label: tr('mobile.common.all') }, ...TX_TYPES.map((v) => ({ value: v, label: tr(`finance.transactions.type_${v}`) }))]}
            />
            <FilterChips<StatusFilter>
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: tr('mobile.finance.any_status') },
                { value: 'posted', label: tr('finance.transactions.status_posted') },
                { value: 'void', label: tr('finance.transactions.status_void') },
              ]}
            />
          </Section>
        </View>
      }
      renderItem={({ item, index }) => (
        <View
          style={{
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderTopWidth: index === 0 ? 1 : 0,
            borderBottomWidth: index === count - 1 ? 1 : 0,
            borderTopLeftRadius: index === 0 ? t.radius.lg : 0,
            borderTopRightRadius: index === 0 ? t.radius.lg : 0,
            borderBottomLeftRadius: index === count - 1 ? t.radius.lg : 0,
            borderBottomRightRadius: index === count - 1 ? t.radius.lg : 0,
            overflow: 'hidden',
          }}
        >
          <TransactionRow txn={item} perspective={perspective} last={index === count - 1} />
        </View>
      )}
      onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => {
            onRefresh();
            list.refetch();
          }}
          tintColor={t.colors.primary}
        />
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
      ListEmptyComponent={
        list.isLoading ? (
          <ListSkeleton rows={4} height={56} />
        ) : list.isError ? (
          <ErrorState description={tr('finance.transactions.error_description')} onRetry={() => list.refetch()} />
        ) : (
          <EmptyState icon={<ScrollText size={28} color={t.colors.textMuted} />} title={tr('finance.transactions.empty')} description={tr('finance.detail.ledger_empty')} />
        )
      }
    />
  );
}
