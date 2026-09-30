import { router } from 'expo-router';
import { ShoppingBag } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, Screen, SearchBar, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { localToday } from '@/features/jobs/lib/job-ui';
import { useSalesInfinite, useSalesSummary } from '@/features/queries';
import { DaySwitcher, DocStatusBadge, StatStrip } from '@/features/sales/components/commerce-parts';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const STATUS_TABS = ['all', 'posted', 'voided'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default function SalesScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.salesRead} title={tr('sales.title')}>
      <SalesList />
    </RequirePermission>
  );
}

function SalesList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const canWrite = can(P.salesWrite);
  const [date, setDate] = useState(localToday);
  const [status, setStatus] = useState<StatusTab>('all');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const list = useSalesInfinite({ sort: '-sold_at', q: query || undefined, status: status === 'all' ? undefined : status, date_from: date, date_to: date });
  const summary = useSalesSummary(date);
  const s = summary.data;
  const currency = list.items[0]?.currency ?? 'TRY';
  const openQuickSale = () => router.push('/sales/new');

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('sales.title')}
          subtitle={tr('sales.description')}
          right={canWrite ? <IconButton variant="primary" label={tr('sales.quick.title')} icon={<ShoppingBag size={20} color={t.colors.onPrimary} />} onPress={openQuickSale} /> : undefined}
        />
      }
    >
      <FlatList
        data={list.items}
        keyExtractor={(sale) => sale.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <DaySwitcher date={date} onChange={setDate} />
            <StatStrip
              loading={summary.isLoading}
              stats={[
                { label: tr('sales.summary.sale_count'), value: String(s?.sale_count ?? 0) },
                { label: tr('sales.summary.paid_total'), value: fmt.money(s?.paid_total, currency), accent: true },
                { label: tr('sales.summary.card_total'), value: fmt.money(s?.card_total, currency) },
                { label: tr('sales.summary.cari_total'), value: fmt.money(s?.cari_total, currency) },
                { label: tr('sales.summary.net_total'), value: fmt.money(s?.net_total, currency) },
              ]}
            />
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('sales.search_placeholder')} />
            <FilterChips<StatusTab> value={status} onChange={setStatus} options={STATUS_TABS.map((v) => ({ value: v, label: tr(`sales.filter.${v}`) }))} />
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
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={84} />
          ) : list.isError ? (
            <ErrorState description={tr('sales.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<ShoppingBag size={28} color={t.colors.textMuted} />}
              title={tr('sales.empty_title')}
              description={tr('sales.empty_hint')}
              action={canWrite ? <Button label={tr('sales.quick.title')} icon={<ShoppingBag size={18} color={t.colors.onPrimary} />} onPress={openQuickSale} /> : undefined}
            />
          )
        }
        renderItem={({ item: sale }) => (
          <Card onPress={() => router.push(`/sales/${sale.uuid}`)} style={{ gap: 6 }} accessibilityLabel={sale.customer_name || tr('sales.walk_in')}>
            <Row gap={t.spacing.sm}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1} tone={sale.status === 'voided' ? 'muted' : 'default'}>
                  {sale.customer_name || tr('sales.walk_in')}
                </Txt>
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {tr(`sales.payment_method.${sale.method}`)}
                  {sale.customer_phone ? ` · ${sale.customer_phone}` : ''}
                </Txt>
              </View>
              <DocStatusBadge ns="sales" status={sale.status} />
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                {fmt.dateTime(sale.sold_at)}
              </Txt>
              <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'], textDecorationLine: sale.status === 'voided' ? 'line-through' : 'none' }}>
                {fmt.money(sale.total_amount, sale.currency)}
              </Txt>
            </Row>
          </Card>
        )}
      />
    </Screen>
  );
}
