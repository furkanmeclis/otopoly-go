import { router } from 'expo-router';
import { Building2, Plus } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, Screen, SearchBar, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useSuppliersInfinite } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type ActiveFilter = 'all' | 'true' | 'false';

export default function SuppliersScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.suppliersRead} title={tr('suppliers.title')}>
      <SuppliersList />
    </RequirePermission>
  );
}

function SuppliersList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  // Web `useTenantSuppliersAccess`: write = owner membership + suppliers.write.
  const canWrite = can({ perm: P.suppliersWrite, owner: true });
  const [q, setQ] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const query = useDeferredValue(q.trim());
  const list = useSuppliersInfinite({ sort: 'name', q: query || undefined, is_active: active === 'all' ? undefined : active });
  const openCreate = () => router.push('/suppliers/form');

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('suppliers.title')}
          subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('suppliers.description')}
          right={canWrite ? <IconButton variant="primary" label={tr('suppliers.new')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={openCreate} /> : undefined}
        />
      }
    >
      <FlatList
        data={list.items}
        keyExtractor={(s) => s.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('suppliers.name')}, ${tr('suppliers.phone')}, ${tr('suppliers.tax_id')}`} />
            <FilterChips<ActiveFilter>
              value={active}
              onChange={setActive}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'true', label: tr('common.active') },
                { value: 'false', label: tr('common.passive') },
              ]}
            />
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={72} />
          ) : list.isError ? (
            <ErrorState description={tr('suppliers.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Building2 size={28} color={t.colors.textMuted} />}
              title={tr('suppliers.empty_title')}
              description={q ? undefined : tr('suppliers.empty_description')}
              action={canWrite && !q ? <Button label={tr('suppliers.new')} onPress={openCreate} /> : undefined}
            />
          )
        }
        renderItem={({ item: s }) => (
          <Card onPress={() => router.push(`/suppliers/${s.uuid}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.md }} accessibilityLabel={s.name}>
            <Avatar name={s.name} size={42} tone="info" />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="bodyStrong" numberOfLines={1} tone={s.is_active ? 'default' : 'muted'}>
                {s.name}
              </Txt>
              {s.email ? (
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {s.email}
                </Txt>
              ) : null}
              <Row gap={t.spacing.md}>
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {s.phone || '—'}
                </Txt>
                {s.tax_id ? (
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {tr('suppliers.tax_id')}: {s.tax_id}
                  </Txt>
                ) : null}
              </Row>
              <Txt variant="caption" tone="muted">
                {tr('suppliers.created_at')}: {fmt.date(s.created_at)}
              </Txt>
            </View>
            <Badge size="sm" tone={s.is_active ? 'success' : 'neutral'} label={s.is_active ? tr('common.active') : tr('common.passive')} />
          </Card>
        )}
      />
    </Screen>
  );
}
