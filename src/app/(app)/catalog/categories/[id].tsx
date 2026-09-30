import { router, useLocalSearchParams } from 'expo-router';
import { Pencil, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, ErrorState, Header, IconButton, InfoRow, ListSkeleton, Row, Screen, Section, Skeleton, Txt, useConfirm } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ActiveBadge, ProductCard, ServiceCard, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { CategoryFormSheet } from '@/features/catalog/components/category-form-sheet';
import { useCategory } from '@/features/catalog/queries';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { qk, useProducts, useServices } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const PREVIEW = 20;

export default function CategoryDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('catalog.detail.category_title')}>
      <CategoryDetail />
    </RequirePermission>
  );
}

function CategoryDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canWrite } = useCatalogAccess();
  const confirm = useConfirm();
  const query = useCategory(id);
  const c = query.data;
  const [editing, setEditing] = useState(false);
  const isProduct = c?.kind === 'product';
  // Web embeds the products/services table filtered by this category; mobile shows the first page and links to the full list.
  const products = useProducts({ category_uuid: id, sort: 'name', limit: PREVIEW });
  const services = useServices({ category_uuid: id, sort: 'name', limit: PREVIEW });
  const linked = isProduct ? products : services;
  const linkedTotal = linked.data?.total ?? 0;

  const remove = useApiMutation({
    key: 'catalog.categories.delete',
    fn: () => catalogService.deleteCategory(id),
    invalidate: [qk.catalog],
    success: tr('catalog.categories.deleted_success'),
    toastValidation: true,
    onSuccess: () => router.back(),
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('catalog.detail.category_title')} />}>
        <ListSkeleton rows={4} height={80} />
      </Screen>
    );
  }
  if (query.isError || !c) {
    return (
      <Screen header={<Header title={tr('catalog.detail.category_title')} />}>
        <ErrorState description={tr('catalog.detail.category_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const kindLabel = isProduct ? tr('catalog.categories.kind_product') : tr('catalog.categories.kind_service');
  const listPath = isProduct ? '/catalog/products' : '/catalog/services';

  return (
    <Screen
      header={
        <Header
          title={c.name}
          subtitle={tr('catalog.detail.category_description')}
          right={canWrite ? <IconButton label={tr('common.edit')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => setEditing(true)} /> : undefined}
        />
      }
      refreshing={query.isRefetching}
      onRefresh={() => {
        query.refetch();
        linked.refetch();
      }}
    >
      <Row gap={t.spacing.sm} wrap>
        <Badge label={kindLabel} tone="neutral" />
        <ActiveBadge active={c.is_active} size="md" />
      </Row>

      <Section title={tr('catalog.detail.category_info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.categories.name')} value={c.name} />
          <InfoRow label={tr('catalog.categories.kind')} value={kindLabel} />
          <InfoRow label={tr('catalog.categories.parent')} value={c.parent_name || '—'} />
          <InfoRow label={tr('catalog.categories.sort_order')} value={String(c.sort_order)} />
          <InfoRow label={tr('catalog.detail.created_at')} value={fmt.dateTime(c.created_at)} />
          <InfoRow label={tr('catalog.detail.updated_at')} value={fmt.dateTime(c.updated_at)} last />
        </Card>
      </Section>

      <Section
        title={isProduct ? tr('catalog.detail.products_in_category') : tr('catalog.detail.services_in_category')}
        action={linkedTotal > PREVIEW ? { label: tr('mobile.common.see_all'), onPress: () => router.push({ pathname: listPath, params: { category: c.uuid } }) } : undefined}
      >
        {linked.isLoading ? (
          <Skeleton height={72} />
        ) : linked.isError ? (
          <ErrorState onRetry={() => linked.refetch()} />
        ) : linkedTotal === 0 ? (
          <Card>
            <Txt tone="secondary">{isProduct ? tr('catalog.products.empty_title') : tr('catalog.services.empty_title')}</Txt>
          </Card>
        ) : (
          <View style={{ gap: t.spacing.sm }}>
            {isProduct
              ? (products.data?.items ?? []).map((p) => <ProductCard key={p.uuid} product={p} onPress={() => router.push(`/catalog/products/${p.uuid}`)} />)
              : (services.data?.items ?? []).map((s) => <ServiceCard key={s.uuid} service={s} onPress={() => router.push(`/catalog/services/${s.uuid}`)} />)}
          </View>
        )}
      </Section>

      {canWrite ? (
        <Button
          variant="outline"
          label={tr('catalog.categories.delete')}
          icon={<Trash2 size={18} color={t.colors.danger} />}
          loading={remove.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('catalog.categories.delete'), message: tr('catalog.categories.delete_confirm'), destructive: true, confirmLabel: tr('common.delete') })) remove.mutate(undefined);
          }}
        />
      ) : null}

      <CategoryFormSheet visible={editing} onClose={() => setEditing(false)} category={c} />
    </Screen>
  );
}
