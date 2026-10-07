import { router } from 'expo-router';
import { Banknote, Landmark, Plus, Wallet } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount, Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, SearchBar, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { AccountSheet } from '@/features/finance/components/account-sheet';
import { accountTypeKey } from '@/features/finance/components/finance-parts';
import { useAccountsInfinite } from '@/features/finance/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type ActiveFilter = 'all' | 'true' | 'false';
type SortKey = 'name' | '-current_balance' | 'current_balance' | 'currency';

export default function FinanceAccountsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.accounts.title')}>
      <AccountsList />
    </RequirePermission>
  );
}

function AccountsList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const [q, setQ] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [createOpen, setCreateOpen] = useState(false);
  const query = useDeferredValue(q.trim());
  const list = useAccountsInfinite({ q: query || undefined, is_active: active === 'all' ? undefined : active, sort });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('finance.accounts.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('finance.accounts.subtitle')}
        right={
          canWrite ? (
            <IconButton variant="primary" label={tr('finance.accounts.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => setCreateOpen(true)} />
          ) : undefined
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(a) => a.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('finance.accounts.name')}, ${tr('finance.accounts.bank_name')}, ${tr('finance.accounts.iban')}`} />
            <FilterChips<ActiveFilter>
              value={active}
              onChange={setActive}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'true', label: tr('finance.filters.active') },
                { value: 'false', label: tr('finance.filters.inactive') },
              ]}
            />
            <FilterChips<SortKey>
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name', label: tr('mobile.finance.sort_name') },
                { value: '-current_balance', label: tr('mobile.finance.sort_balance_desc') },
                { value: 'current_balance', label: tr('mobile.finance.sort_balance_asc') },
                { value: 'currency', label: tr('finance.accounts.currency') },
              ]}
            />
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={4} height={72} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('finance.accounts.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Wallet size={28} color={t.colors.textMuted} />}
              title={tr('finance.summary.no_accounts')}
              description={q ? undefined : tr('finance.summary.no_accounts_description')}
              action={canWrite && !q ? <Button label={tr('finance.accounts.create')} onPress={() => setCreateOpen(true)} /> : undefined}
            />
          )
        }
        renderItem={({ item: a }) => {
          const negative = a.negative_balance || toNumber(a.current_balance) < 0;
          return (
            <Card
              onPress={() => router.push(`/finance/accounts/${a.uuid}`)}
              accessibilityLabel={a.name}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.md, opacity: a.is_active ? 1 : 0.7 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: a.type === 'bank' ? t.colors.infoBg : t.colors.successBg,
                }}
              >
                {a.type === 'bank' ? <Landmark size={20} color={t.colors.info} /> : <Banknote size={20} color={t.colors.success} />}
              </View>
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                <Row gap={6} wrap>
                  <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {a.name}
                  </Txt>
                  {a.is_default ? <Badge size="sm" tone="primary" label={tr('finance.accounts.default')} /> : null}
                  {!a.is_active ? <Badge size="sm" tone="neutral" label={tr('finance.filters.inactive')} /> : null}
                </Row>
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {[tr(accountTypeKey(a.type)), a.currency, a.bank_name].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              <Amount value={a.current_balance} currency={a.currency} tone={negative ? 'danger' : 'default'} />
            </Card>
          );
        }}
      />
      <AccountSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </SafeAreaView>
  );
}
