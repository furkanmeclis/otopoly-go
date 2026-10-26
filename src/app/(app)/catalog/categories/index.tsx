import { router } from 'expo-router';
import { Layers, Plus } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, SearchBar, Segmented, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ActiveBadge, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { CategoryFormSheet } from '@/features/catalog/components/category-form-sheet';
import { useCategoryList } from '@/features/catalog/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

type Tab = 'all' | 'product' | 'service';
type ActiveFilter = 'all' | 'true' | 'false';

export default function CategoriesScreen() {
  useLiveResource('tenant.catalog.categories');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('catalog.categories.title')}>
      <CategoriesList />
    </RequirePermission>
  );
}

/** Web `CategoriesPage`: all/product/service tabs, search, active filter, sort_order order (not paginated). */
function CategoriesList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { canWrite } = useCatalogAccess();
  const [tab, setTab] = useState<Tab>('all');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const query = useDeferredValue(q);
  const list = useCategoryList({ kind: tab === 'all' ? undefined : tab, is_active: active === 'all' ? undefined : active, q: query.trim() || undefined });
  const items = list.data?.items ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('catalog.categories.title')}
        subtitle={tr('catalog.categories.description')}
        right={canWrite ? <IconButton variant="primary" label={tr('catalog.categories.new')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => setCreateOpen(true)} /> : undefined}
      />
      <FlatList
        data={items}
        keyExtractor={(c) => c.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'all', label: tab === 'all' && list.data ? `${tr('catalog.categories.tab_all')} (${items.length})` : tr('catalog.categories.tab_all') },
                { value: 'product', label: tr('mobile.catalog.tab_products') },
                { value: 'service', label: tr('mobile.catalog.tab_services') },
              ]}
            />
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('catalog.categories.name')} />
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
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={64} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('catalog.categories.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Layers size={28} color={t.colors.textMuted} />}
              title={tr('catalog.categories.empty_title')}
              description={q ? undefined : tr('catalog.categories.empty_description')}
              action={canWrite && !q ? <Button label={tr('catalog.categories.new')} onPress={() => setCreateOpen(true)} /> : undefined}
            />
          )
        }
        renderItem={({ item: c }) => (
          <Card onPress={() => router.push(`/catalog/categories/${c.uuid}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.md }} accessibilityLabel={c.name}>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="bodyStrong" numberOfLines={1} tone={c.is_active ? 'default' : 'muted'}>
                {c.name}
              </Txt>
              <Txt variant="caption" tone="secondary" numberOfLines={1}>
                {`${tr('catalog.categories.parent')}: ${c.parent_name || '—'} · ${tr('catalog.categories.sort_order')}: ${c.sort_order}`}
              </Txt>
            </View>
            <Row gap={6}>
              <Badge size="sm" tone={c.kind === 'product' ? 'info' : 'primary'} label={c.kind === 'product' ? tr('mobile.catalog.kind_product_short') : tr('mobile.catalog.kind_service_short')} />
              {!c.is_active ? <ActiveBadge active={false} /> : null}
            </Row>
          </Card>
        )}
      />
      <CategoryFormSheet visible={createOpen} onClose={() => setCreateOpen(false)} defaultKind={tab === 'service' ? 'service' : 'product'} />
    </SafeAreaView>
  );
}
