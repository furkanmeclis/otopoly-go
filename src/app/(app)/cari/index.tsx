import { router } from 'expo-router';
import { Receipt, SlidersHorizontal } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, KpiTile, ListSkeleton, Row, Screen, SearchBar, Segmented, Sheet, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useCariInfinite, useCariSummary } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type BalanceFilter = 'all' | 'true' | 'false';
type ActiveFilter = 'all' | 'true' | 'false';
type Sort = 'customer_name' | '-customer_name' | '-balance' | 'balance';

export default function CariScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.cariRead} title={tr('cari.title')}>
      <CariList />
    </RequirePermission>
  );
}

function CariList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [q, setQ] = useState('');
  const [balance, setBalance] = useState<BalanceFilter>('all');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [sort, setSort] = useState<Sort>('customer_name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useDeferredValue(q.trim());
  const list = useCariInfinite({
    sort,
    q: query || undefined,
    has_balance: balance === 'all' ? undefined : balance,
    is_active: active === 'all' ? undefined : active,
  });
  const summary = useCariSummary();
  const s = summary.data;
  const currency = list.items[0]?.currency ?? 'TRY';
  const activeFilters = Number(active !== 'all') + Number(sort !== 'customer_name');

  return (
    <Screen scroll={false} header={<Header title={tr('cari.title')} subtitle={tr('cari.description')} />}>
      <FlatList
        data={list.items}
        keyExtractor={(a) => a.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <Row gap={t.spacing.sm} wrap>
              <KpiTile label={tr('cari.summary.total_receivable')} value={summary.isLoading ? '…' : fmt.money(s?.total_receivable, currency)} tone="warning" style={{ minWidth: '100%' }} />
              <KpiTile label={tr('cari.summary.account_count')} value={summary.isLoading ? '…' : String(s?.account_count ?? 0)} />
              <KpiTile label={tr('cari.summary.with_balance_count')} value={summary.isLoading ? '…' : String(s?.with_balance_count ?? 0)} />
            </Row>
            <Row gap={t.spacing.sm}>
              <View style={{ flex: 1 }}>
                <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('cari.customer_name')}, ${tr('cari.customer_phone')}`} />
              </View>
              <IconButton
                label={tr('mobile.commerce.filters')}
                icon={<SlidersHorizontal size={18} color={activeFilters ? t.colors.primary : t.colors.text} />}
                badge={activeFilters || undefined}
                onPress={() => setFiltersOpen(true)}
              />
            </Row>
            <FilterChips<BalanceFilter>
              value={balance}
              onChange={setBalance}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'true', label: tr('cari.has_balance_yes') },
                { value: 'false', label: tr('cari.has_balance_no') },
              ]}
            />
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={(list.isRefetching && !list.isFetchingNextPage) || summary.isRefetching}
            onRefresh={() => {
              list.refetch();
              summary.refetch();
            }}
            tintColor={t.colors.primary}
          />
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={68} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('cari.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState icon={<Receipt size={28} color={t.colors.textMuted} />} title={tr('cari.empty_title')} description={q ? undefined : tr('cari.empty_description')} />
          )
        }
        renderItem={({ item: a }) => {
          const bal = toNumber(a.balance);
          return (
            <Card onPress={() => router.push(`/cari/${a.uuid}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.md }} accessibilityLabel={a.customer_name}>
              <Avatar name={a.customer_name} size={42} tone={a.customer_kind === 'company' ? 'info' : 'primary'} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt variant="bodyStrong" numberOfLines={1} tone={a.is_active ? 'default' : 'muted'}>
                  {a.customer_name}
                </Txt>
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {a.customer_phone || '—'} · {a.currency}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Txt variant="bodyStrong" tone={bal > 0 ? 'warning' : 'default'} style={{ fontVariant: ['tabular-nums'] }}>
                  {fmt.money(a.balance, a.currency)}
                </Txt>
                {!a.is_active ? <Badge size="sm" tone="neutral" label={tr('common.passive')} /> : null}
              </View>
            </Card>
          );
        }}
      />

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={tr('mobile.commerce.filters')}
        footer={
          <Row gap={t.spacing.sm}>
            <Button
              style={{ flex: 1 }}
              variant="outline"
              label={tr('mobile.commerce.reset_filters')}
              onPress={() => {
                setActive('all');
                setSort('customer_name');
              }}
            />
            <Button style={{ flex: 1 }} label={tr('mobile.common.done')} onPress={() => setFiltersOpen(false)} />
          </Row>
        }
      >
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('common.status')}
          </Txt>
          <Segmented<ActiveFilter>
            value={active}
            onChange={setActive}
            options={[
              { value: 'all', label: tr('mobile.common.all') },
              { value: 'true', label: tr('common.active') },
              { value: 'false', label: tr('common.passive') },
            ]}
          />
        </View>
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('mobile.commerce.sort')}
          </Txt>
          <FilterChips<Sort>
            value={sort}
            onChange={setSort}
            options={[
              { value: 'customer_name', label: tr('mobile.commerce.sort_name_asc') },
              { value: '-customer_name', label: tr('mobile.commerce.sort_name_desc') },
              { value: '-balance', label: tr('mobile.commerce.sort_balance_desc') },
              { value: 'balance', label: tr('mobile.commerce.sort_balance_asc') },
            ]}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
