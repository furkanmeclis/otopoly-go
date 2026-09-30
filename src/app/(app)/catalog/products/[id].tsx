import { router, useLocalSearchParams } from 'expo-router';
import { ArrowUpDown, Pencil, Trash2 } from 'lucide-react-native';
import { useState } from 'react';

import { Button, Card, ErrorState, Header, IconButton, InfoRow, ListSkeleton, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ActiveBadge, StockBadge, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { StockAdjustSheet } from '@/features/catalog/components/stock-adjust-sheet';
import { catalogUnitLabel } from '@/features/catalog/lib/units';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { qk, useProduct } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.catalog.product');

export default function ProductDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('catalog.detail.product_title')}>
      <ProductDetail />
    </RequirePermission>
  );
}

function ProductDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canWrite } = useCatalogAccess();
  const confirm = useConfirm();
  const query = useProduct(id);
  const p = query.data;
  const [adjusting, setAdjusting] = useState(false);

  const remove = useApiMutation({
    key: 'catalog.products.delete',
    fn: () => catalogService.deleteProduct(id),
    invalidate: [qk.catalog],
    success: tr('catalog.products.deleted_success'),
    toastValidation: true,
    onSuccess: () => {
      log.info('Product deleted', { uuid: id });
      router.back();
    },
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('catalog.detail.product_title')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (query.isError || !p) {
    return (
      <Screen header={<Header title={tr('catalog.detail.product_title')} />}>
        <ErrorState description={tr('catalog.detail.product_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const unit = catalogUnitLabel(tr, p.unit);

  return (
    <Screen
      header={
        <Header
          title={p.name}
          subtitle={tr('catalog.detail.product_description')}
          right={canWrite ? <IconButton label={tr('common.edit')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => router.push({ pathname: '/catalog/products/form', params: { id: p.uuid } })} /> : undefined}
        />
      }
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <Row gap={t.spacing.sm} wrap>
        <ActiveBadge active={p.is_active} size="md" />
        <StockBadge status={p.stock_status} size="md" />
      </Row>

      {canWrite && p.track_stock ? <Button variant="outline" label={tr('catalog.products.adjust_stock')} icon={<ArrowUpDown size={16} color={t.colors.text} />} onPress={() => setAdjusting(true)} /> : null}

      <Section title={tr('catalog.detail.product_info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.products.name')} value={p.name} />
          <InfoRow label={tr('catalog.products.category')} value={p.category_name || '—'} />
          <InfoRow label={tr('catalog.products.sku')} value={p.sku || '—'} />
          <InfoRow label={tr('catalog.products.barcode')} value={p.barcode || '—'} />
          <InfoRow label={tr('catalog.products.unit')} value={unit} last />
        </Card>
      </Section>

      <Section title={tr('mobile.catalog.pricing')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.products.cost_price')} value={fmt.money(p.cost_price, p.currency)} />
          <InfoRow label={tr('catalog.products.sale_price')} value={fmt.money(p.sale_price, p.currency)} />
          <InfoRow label={tr('catalog.products.vat_rate')} value={`%${p.vat_rate}`} />
          <InfoRow label={tr('catalog.products.currency')} value={p.currency} last />
        </Card>
      </Section>

      <Section title={tr('catalog.products.stock_status')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.products.track_stock')} value={p.track_stock ? tr('common.yes') : tr('common.no')} />
          <InfoRow label={tr('catalog.products.stock_quantity')} value={`${fmt.number(p.stock_quantity, 3)} ${unit}`} />
          <InfoRow label={tr('catalog.products.min_stock_alert')} value={`${fmt.number(p.min_stock_alert, 3)} ${unit}`} />
          <InfoRow label={tr('catalog.detail.created_at')} value={fmt.dateTime(p.created_at)} />
          <InfoRow label={tr('catalog.detail.updated_at')} value={fmt.dateTime(p.updated_at)} last />
        </Card>
      </Section>

      {p.description ? (
        <Card>
          <Txt tone="secondary">{p.description}</Txt>
        </Card>
      ) : null}

      {canWrite ? (
        <Button
          variant="outline"
          label={tr('catalog.products.delete')}
          icon={<Trash2 size={18} color={t.colors.danger} />}
          loading={remove.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('catalog.products.delete'), message: tr('catalog.products.delete_confirm'), destructive: true, confirmLabel: tr('common.delete') })) remove.mutate(undefined);
          }}
        />
      ) : null}

      <StockAdjustSheet product={p} visible={adjusting} onClose={() => setAdjusting(false)} />
    </Screen>
  );
}
