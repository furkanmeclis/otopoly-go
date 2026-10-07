import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Wrench } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, FilterChips, Header, IconButton, KpiTile, ListSkeleton, Row, SearchBar, SelectField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ServiceCard, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { FilterButton, FilterSheet } from '@/features/catalog/components/list-filters';
import { useActiveCategories } from '@/features/catalog/queries';
import { useCatalogSummary, useServicesInfinite } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type ActiveFilter = 'all' | 'true' | 'false';
const SORTS = ['name', '-name', 'price', '-price', 'duration_minutes', '-duration_minutes'] as const;
type Sort = (typeof SORTS)[number];

export default function ServicesScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('catalog.services.title')}>
      <ServicesList />
    </RequirePermission>
  );
}

function ServicesList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { canWrite } = useCatalogAccess();
  const params = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [sort, setSort] = useState<Sort>('name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useDeferredValue(q);
  const categories = useActiveCategories('service');
  const summary = useCatalogSummary();
  const list = useServicesInfinite({
    q: query.trim() || undefined,
    is_active: active === 'all' ? undefined : active,
    category_uuid: category ?? undefined,
    sort,
  });
  const activeFilters = [category, sort !== 'name' ? sort : null].filter(Boolean).length;
  const s = summary.data;
  const create = () => router.push('/catalog/services/form');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('catalog.services.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : undefined}
        right={
          <Row gap={t.spacing.sm}>
            <FilterButton active={activeFilters} onPress={() => setFiltersOpen(true)} />
            {canWrite ? <IconButton variant="primary" label={tr('catalog.services.new')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={create} /> : null}
          </Row>
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(x) => x.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            {s ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <KpiTile label={tr('catalog.summary.total_services')} value={String(s.total_services)} />
                <KpiTile tone="success" label={tr('catalog.summary.active_services')} value={String(s.active_services)} />
                <KpiTile tone="info" label={tr('catalog.summary.total_categories')} value={String(s.total_categories)} />
              </View>
            ) : null}
            <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('catalog.services.name')}, ${tr('catalog.services.code')}`} />
            <FilterChips<ActiveFilter>
              value={active}
              onChange={setActive}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'true', label: tr('common.active') },
                { value: 'false', label: tr('common.passive') },
              ]}
            />
            {category ? (
              <Txt variant="caption" tone="secondary">
                {`${tr('catalog.services.category')}: ${categories.data?.items.find((c) => c.uuid === category)?.name ?? '…'}`}
              </Txt>
            ) : null}
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
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
            <ListSkeleton rows={6} height={84} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('catalog.services.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Wrench size={28} color={t.colors.textMuted} />}
              title={tr('catalog.services.empty_title')}
              description={q || activeFilters || active !== 'all' ? undefined : tr('catalog.services.empty_description')}
              action={canWrite && !q ? <Button label={tr('catalog.services.new')} onPress={create} /> : undefined}
            />
          )
        }
        renderItem={({ item }) => <ServiceCard service={item} onPress={() => router.push(`/catalog/services/${item.uuid}`)} />}
      />

      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onReset={() => {
          setCategory(null);
          setSort('name');
        }}
      >
        <SelectField
          label={tr('catalog.services.category')}
          value={category}
          onChange={setCategory}
          options={(categories.data?.items ?? []).map((c) => ({ value: c.uuid, label: c.name }))}
          placeholder={tr('mobile.common.all')}
          loading={categories.isLoading}
          allowClear
          searchable
        />
        <SelectField
          label={tr('mobile.catalog.sort')}
          value={sort}
          onChange={(v) => setSort((v as Sort | null) ?? 'name')}
          options={SORTS.map((value) => ({ value, label: tr(`mobile.catalog.sort_${value.replace('-', 'desc_')}`) }))}
        />
      </FilterSheet>
    </SafeAreaView>
  );
}
