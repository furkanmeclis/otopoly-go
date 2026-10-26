import { router, useLocalSearchParams } from 'expo-router';
import { ArrowUpDown, Package, Pencil, ShoppingCart, Trash2 } from 'lucide-react-native';
import { View } from 'react-native';
import { useState } from 'react';

import { Button, Card, DetailHero, ErrorState, Header, IconButton, InfoRow, LinkValue, ListSkeleton, QuickActions, Screen, Section, StatGrid, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ActiveBadge, StockBadge, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { StockAdjustSheet } from '@/features/catalog/components/stock-adjust-sheet';
import { catalogUnitLabel } from '@/features/catalog/lib/units';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { qk, useProduct } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

const log = createLogger('screen.catalog.product');

export default function ProductDetailScreen() {
  useLiveResource('tenant.catalog.products');
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
  const { can } = useAuth();
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
        <ErrorState error={query.error} description={tr('catalog.detail.product_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const unit = catalogUnitLabel(tr, p.unit);
  const qty = toNumber(p.stock_quantity);
  const cost = toNumber(p.cost_price);
  const price = toNumber(p.sale_price);
  const marginPct = price > 0 ? (price - cost) / price : null;
  const stockTone = p.stock_status === 'out_of_stock' ? 'danger' : p.stock_status === 'low_stock' ? 'warning' : 'success';

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
      onRefresh={() => void query.refetch()}
    >
      <DetailHero
        leading={
          <View style={{ width: 52, height: 52, borderRadius: t.radius.lg, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Package size={24} color={t.colors.primary} />
          </View>
        }
        title={p.name}
        subtitle={[p.category_name, p.sku].filter(Boolean).join(' · ') || undefined}
        badges={
          <>
            <ActiveBadge active={p.is_active} />
            {p.track_stock ? <StockBadge status={p.stock_status} /> : null}
          </>
        }
      >
        <QuickActions
          actions={[
            canWrite &&
              p.track_stock && {
                key: 'stock',
                label: tr('catalog.products.adjust_stock'),
                tone: 'primary',
                icon: <ArrowUpDown size={20} color={t.colors.onPrimary} />,
                onPress: () => setAdjusting(true),
              },
            can(P.salesWrite) && { key: 'sale', label: tr('mobile.detail.new_sale'), icon: <ShoppingCart size={20} color={t.colors.primary} />, onPress: () => router.push('/sales/new') },
            canWrite && { key: 'edit', label: tr('common.edit'), icon: <Pencil size={20} color={t.colors.primary} />, onPress: () => router.push({ pathname: '/catalog/products/form', params: { id: p.uuid } }) },
          ]}
        />
      </DetailHero>

      <StatGrid
        items={[
          p.track_stock
            ? { label: tr('catalog.products.stock_quantity'), value: `${fmt.number(qty, 3)} ${unit}`, hint: `${tr('catalog.products.min_stock_alert')}: ${fmt.number(p.min_stock_alert, 3)}`, tone: stockTone }
            : { label: tr('catalog.products.track_stock'), value: tr('common.no') },
          { label: tr('catalog.products.sale_price'), value: fmt.money(p.sale_price, p.currency), hint: `${tr('catalog.products.cost_price')}: ${fmt.money(p.cost_price, p.currency)}` },
          { label: tr('jobs.consumptions.margin'), value: marginPct == null ? '—' : fmt.percent(marginPct), tone: marginPct == null ? 'default' : marginPct >= 0 ? 'success' : 'danger' },
          ...(p.track_stock ? [{ label: tr('catalog.summary.total_stock_cost_value'), value: fmt.money(qty * cost, p.currency) }] : []),
        ]}
      />

      <Section title={tr('catalog.detail.product_info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.products.name')} value={p.name} />
          <InfoRow label={tr('catalog.products.category')}>
            <LinkValue label={p.category_name || '—'} onPress={p.category_uuid ? () => router.push(`/catalog/categories/${p.category_uuid}`) : undefined} />
          </InfoRow>
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
