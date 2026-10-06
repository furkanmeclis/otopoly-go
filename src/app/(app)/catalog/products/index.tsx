import { router, useLocalSearchParams } from 'expo-router';
import { Package, Plus } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, FilterChips, Header, IconButton, KpiTile, ListSkeleton, Row, SearchBar, Segmented, SelectField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ProductCard, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { FilterButton, FilterSheet } from '@/features/catalog/components/list-filters';
import { CATALOG_UNIT_KEYS } from '@/features/catalog/lib/units';
import { useActiveCategories } from '@/features/catalog/queries';
import { useCatalogSummary, useProductsInfinite } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'untracked';
type ActiveFilter = 'all' | 'true' | 'false';
const SORTS = ['name', '-name', 'sale_price', '-sale_price', 'stock_quantity', '-stock_quantity'] as const;
type Sort = (typeof SORTS)[number];

export default function ProductsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('catalog.products.title')}>
      <ProductsList />
    </RequirePermission>
  );
}

function ProductsList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { canWrite } = useCatalogAccess();
  const params = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState('');
  const [stock, setStock] = useState<StockFilter>('all');
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [unit, setUnit] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveFilter>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const query = useDeferredValue(q);
  const categories = useActiveCategories('product');
  const summary = useCatalogSummary();

  // Same param mapping as web ProductsPage: "untracked" is track_stock=false, other statuses also force track_stock=true.
  const list = useProductsInfinite({
    q: query.trim() || undefined,
    stock_status: stock !== 'all' && stock !== 'untracked' ? stock : undefined,
    track_stock: stock === 'all' ? undefined : stock === 'untracked' ? 'false' : 'true',
    category_uuid: category ?? undefined,
    unit: unit ?? undefined,
    is_active: active === 'all' ? undefined : active,
    sort,
  });
  const activeFilters = [category, unit, active !== 'all' ? active : null, sort !== 'name' ? sort : null].filter(Boolean).length;
  const s = summary.data;
  const create = () => router.push('/catalog/products/form');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('catalog.products.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : undefined}
        right={
          <Row gap={t.spacing.sm}>
            <FilterButton active={activeFilters} onPress={() => setFiltersOpen(true)} />
            {canWrite ? <IconButton variant="primary" label={tr('catalog.products.new')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={create} /> : null}
          </Row>
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(p) => p.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            {s ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <KpiTile label={tr('catalog.summary.total_products')} value={String(s.total_products)} />
                <KpiTile tone="warning" label={tr('catalog.summary.low_stock_products')} value={String(s.low_stock_products)} hint={s.low_stock_products > 0 ? tr('catalog.summary.low_stock_hint') : undefined} />
                <KpiTile tone="danger" label={tr('catalog.summary.out_of_stock_products')} value={String(s.out_of_stock_products)} />
                <KpiTile tone="success" label={tr('catalog.summary.total_stock_sale_value')} value={fmt.money(s.total_stock_sale_value)} />
              </View>
            ) : null}
            <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('catalog.products.name')}, ${tr('catalog.products.sku')}, ${tr('catalog.products.barcode')}`} />
            <FilterChips<StockFilter>
              value={stock}
              onChange={setStock}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'in_stock', label: tr('catalog.stock_status.in_stock') },
                { value: 'low_stock', label: tr('catalog.stock_status.low_stock') },
                { value: 'out_of_stock', label: tr('catalog.stock_status.out_of_stock') },
                { value: 'untracked', label: tr('catalog.stock_status.untracked') },
              ]}
            />
            {category ? (
              <Txt variant="caption" tone="secondary">
                {`${tr('catalog.products.category')}: ${categories.data?.items.find((c) => c.uuid === category)?.name ?? '…'}`}
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
            <ListSkeleton rows={6} height={92} />
          ) : list.isError ? (
            <ErrorState description={tr('catalog.products.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Package size={28} color={t.colors.textMuted} />}
              title={tr('catalog.products.empty_title')}
              description={q || activeFilters || stock !== 'all' ? undefined : tr('catalog.products.empty_description')}
              action={canWrite && !q ? <Button label={tr('catalog.products.new')} onPress={create} /> : undefined}
            />
          )
        }
        renderItem={({ item }) => <ProductCard product={item} onPress={() => router.push(`/catalog/products/${item.uuid}`)} />}
      />

      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onReset={() => {
          setCategory(null);
          setUnit(null);
          setActive('all');
          setSort('name');
        }}
      >
        <SelectField
          label={tr('catalog.products.category')}
          value={category}
          onChange={setCategory}
          options={(categories.data?.items ?? []).map((c) => ({ value: c.uuid, label: c.name }))}
          placeholder={tr('mobile.common.all')}
          loading={categories.isLoading}
          allowClear
          searchable
        />
        <SelectField
          label={tr('catalog.products.unit')}
          value={unit}
          onChange={setUnit}
          options={CATALOG_UNIT_KEYS.map((u) => ({ value: u, label: tr(`catalog.products.units.${u}`) }))}
          placeholder={tr('mobile.common.all')}
          allowClear
        />
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
