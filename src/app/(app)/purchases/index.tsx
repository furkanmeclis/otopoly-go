import { router } from 'expo-router';
import { Plus, ShoppingCart } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, Screen, SearchBar, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { localToday } from '@/features/jobs/lib/job-ui';
import { usePurchasesDay } from '@/features/purchases/queries';
import type { PurchaseListItem } from '@/features/purchases/services/purchases.service';
import { usePurchasesInfinite } from '@/features/queries';
import { DaySwitcher, DocStatusBadge, StatStrip } from '@/features/sales/components/commerce-parts';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const STATUS_TABS = ['all', 'posted', 'voided'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default function PurchasesScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.purchasesRead} title={tr('purchases.title')}>
      <PurchasesList />
    </RequirePermission>
  );
}

function PurchasesList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  // Web `useTenantPurchasesAccess`: write = owner membership + purchases.write.
  const canWrite = can({ perm: P.purchasesWrite, owner: true });
  const [date, setDate] = useState(localToday);
  const [status, setStatus] = useState<StatusTab>('all');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const list = usePurchasesInfinite({ sort: '-purchased_at', q: query || undefined, status: status === 'all' ? undefined : status, date_from: date, date_to: date });
  const day = usePurchasesDay(date);

  // No summary endpoint: the web totals the day's posted rows client-side.
  const posted = day.data?.items ?? [];
  const currency = posted[0]?.currency ?? 'TRY';
  const sumBy = (method?: string) => posted.filter((p) => !method || p.method === method).reduce((s, p) => s + toNumber(p.total_amount), 0);
  const openCreate = () => router.push('/purchases/new');

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('purchases.title')}
          subtitle={tr('purchases.description')}
          right={canWrite ? <IconButton variant="primary" label={tr('purchases.actions.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={openCreate} /> : undefined}
        />
      }
    >
      <FlatList
        data={list.items}
        keyExtractor={(p) => p.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <DaySwitcher date={date} onChange={setDate} />
            <StatStrip
              loading={day.isLoading}
              stats={[
                { label: tr('purchases.summary.count'), value: String(posted.length) },
                { label: tr('purchases.summary.total'), value: fmt.money(sumBy(), currency), accent: true },
                { label: tr('purchases.payment_method.cash'), value: fmt.money(sumBy('cash'), currency) },
                { label: tr('purchases.payment_method.card'), value: fmt.money(sumBy('card'), currency) },
              ]}
            />
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('purchases.search_placeholder')} />
            <FilterChips<StatusTab> value={status} onChange={setStatus} options={STATUS_TABS.map((v) => ({ value: v, label: tr(`purchases.filter.${v}`) }))} />
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={(list.isRefetching && !list.isFetchingNextPage) || day.isRefetching}
            onRefresh={() => {
              list.refetch();
              day.refetch();
            }}
            tintColor={t.colors.primary}
          />
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={96} />
          ) : list.isError ? (
            <ErrorState description={tr('purchases.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<ShoppingCart size={28} color={t.colors.textMuted} />}
              title={tr('purchases.empty_title')}
              description={tr('purchases.empty_hint')}
              action={canWrite ? <Button label={tr('purchases.actions.create')} icon={<Plus size={18} color={t.colors.onPrimary} />} onPress={openCreate} /> : undefined}
            />
          )
        }
        renderItem={({ item }) => <PurchaseCard purchase={item} />}
      />
    </Screen>
  );
}

function PurchaseCard({ purchase: p }: { purchase: PurchaseListItem }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const lines = p.lines ?? [];
  const totalQty = lines.reduce((s, l) => s + toNumber(l.qty), 0);
  const voided = p.status === 'voided';
  return (
    <Card onPress={() => router.push(`/purchases/${p.uuid}`)} style={{ gap: 6 }} accessibilityLabel={p.supplier_name}>
      <Row gap={t.spacing.sm}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong" numberOfLines={1} tone={voided ? 'muted' : 'default'}>
            {p.supplier_name}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {fmt.dateTime(p.purchased_at)} · {tr(`purchases.payment_method.${p.method}`)}
          </Txt>
        </View>
        <DocStatusBadge ns="purchases" status={p.status} />
      </Row>
      {lines.length === 0 ? (
        <Txt variant="caption" tone="muted">
          —
        </Txt>
      ) : (
        <View style={{ gap: 2 }}>
          {lines.map((l) => (
            <Txt key={l.uuid} variant="caption" tone="secondary" numberOfLines={1}>
              <Txt variant="caption" style={{ fontWeight: '600' }}>
                {l.name}
              </Txt>
              {`  ${fmt.number(l.qty, 3)} × ${fmt.money(l.unit_cost, l.currency)}`}
            </Txt>
          ))}
        </View>
      )}
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="muted">
          {tr('purchases.qty')}: {fmt.number(totalQty, 3)}
        </Txt>
        <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'], textDecorationLine: voided ? 'line-through' : 'none' }}>
          {fmt.money(p.total_amount, p.currency)}
        </Txt>
      </Row>
    </Card>
  );
}
