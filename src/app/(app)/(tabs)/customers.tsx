import { router, useLocalSearchParams } from 'expo-router';
import { Building2, Car, Plus, UserRound, Users } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, SearchBar, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useCustomersInfinite } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

type KindFilter = 'all' | 'individual' | 'company' | 'passive';

export default function CustomersScreen() {
  useLiveResource('tenant.customers');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.customersRead} title={tr('customers.title')}>
      <CustomersList />
    </RequirePermission>
  );
}

function CustomersList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  // `?q=` opens the list searched (Siri "Plaka ara" with several matches). The tab stays mounted, so a
  // new `q` / `n` (request nonce) is applied while rendering, like the assistant screen's nonce.
  const params = useLocalSearchParams<{ q?: string; n?: string }>();
  const routeQ = typeof params.q === 'string' ? params.q : '';
  const routeKey = `${routeQ}|${params.n ?? ''}`;
  const [appliedKey, setAppliedKey] = useState(routeKey);
  const [q, setQ] = useState(routeQ);
  const [filter, setFilter] = useState<KindFilter>('all');
  if (appliedKey !== routeKey) {
    setAppliedKey(routeKey);
    if (routeQ) {
      setQ(routeQ);
      setFilter('all');
    }
  }
  const query = useDeferredValue(q);
  const list = useCustomersInfinite({
    q: query || undefined,
    kind: filter === 'individual' || filter === 'company' ? filter : undefined,
    is_active: filter === 'passive' ? 'false' : undefined,
    sort: 'name',
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        back={false}
        title={tr('customers.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('customers.description')}
        right={can(P.customersWrite) ? <IconButton variant="primary" label={tr('customers.new')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => router.push('/customers/form')} /> : undefined}
      />
      <FlatList
        data={list.items}
        keyExtractor={(c) => c.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('customers.name')}, ${tr('customers.phone')}, ${tr('customers.detail.plate')}`} />
            <FilterChips<KindFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'individual', label: tr('customers.kind.individual') },
                { value: 'company', label: tr('customers.kind.company') },
                { value: 'passive', label: tr('common.passive') },
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
            <ListSkeleton rows={6} height={68} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('customers.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Users size={28} color={t.colors.textMuted} />}
              title={tr('customers.empty_title')}
              description={q ? undefined : tr('customers.empty_description')}
              action={can(P.customersWrite) && !q ? <Button label={tr('customers.new')} onPress={() => router.push('/customers/form')} /> : undefined}
            />
          )
        }
        renderItem={({ item: c }) => {
          const balance = toNumber(c.cari_balance);
          return (
            <Card onPress={() => router.push(`/customers/${c.uuid}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.md }} accessibilityLabel={c.name}>
              <Avatar name={c.name} size={42} tone={c.kind === 'company' ? 'info' : 'primary'} />
              <View style={{ flex: 1, gap: 3 }}>
                <Row gap={6}>
                  <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }} tone={c.is_active ? 'default' : 'muted'}>
                    {c.name}
                  </Txt>
                  {c.kind === 'company' ? <Building2 size={14} color={t.colors.info} /> : <UserRound size={14} color={t.colors.textMuted} />}
                </Row>
                <Row gap={t.spacing.md}>
                  <Txt variant="caption" tone="secondary" numberOfLines={1}>
                    {c.phone || '—'}
                  </Txt>
                  <Row gap={4}>
                    <Car size={12} color={t.colors.textMuted} />
                    <Txt variant="caption" tone="muted">
                      {c.vehicle_count}
                    </Txt>
                  </Row>
                </Row>
              </View>
              {balance !== 0 ? <Badge size="sm" tone={balance > 0 ? 'warning' : 'success'} label={fmt.money(balance)} /> : null}
              {!c.is_active ? <Badge size="sm" tone="neutral" label={tr('common.passive')} /> : null}
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}
