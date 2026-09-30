import { router } from 'expo-router';
import { AlertTriangle, Layers, Package, PackageX, Wrench } from 'lucide-react-native';
import { View } from 'react-native';

import { ErrorState, Group, Header, KpiTile, ListRow, Screen, Section } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useCatalogSummary } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/**
 * Web `/catalog` only redirects to products; on mobile it is a small hub with the catalog summary
 * (same `/catalog/summary` numbers the web shows above the products/services tables) and links.
 */
export default function CatalogHubScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('layout.section_catalog')}>
      <CatalogHub />
    </RequirePermission>
  );
}

function CatalogHub() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const summary = useCatalogSummary();
  const s = summary.data;
  const v = (n: number | string | undefined, money = false) => (summary.isLoading ? '…' : money ? fmt.money(n) : String(n ?? 0));

  return (
    <Screen header={<Header title={tr('layout.section_catalog')} subtitle={tr('catalog.summary.title')} />} refreshing={summary.isRefetching} onRefresh={() => summary.refetch()}>
      {summary.isError ? (
        <ErrorState onRetry={() => summary.refetch()} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
          <KpiTile tone="primary" icon={<Package size={16} color={t.colors.primary} />} label={tr('catalog.summary.total_products')} value={v(s?.total_products)} hint={s ? `${tr('catalog.summary.active_products')}: ${s.active_products}` : undefined} />
          <KpiTile
            tone="warning"
            icon={<AlertTriangle size={16} color={t.colors.warning} />}
            label={tr('catalog.summary.low_stock_products')}
            value={v(s?.low_stock_products)}
            hint={s && s.low_stock_products > 0 ? tr('catalog.summary.low_stock_hint') : undefined}
          />
          <KpiTile tone="danger" icon={<PackageX size={16} color={t.colors.danger} />} label={tr('catalog.summary.out_of_stock_products')} value={v(s?.out_of_stock_products)} />
          <KpiTile tone="info" icon={<Wrench size={16} color={t.colors.info} />} label={tr('catalog.summary.total_services')} value={v(s?.total_services)} hint={s ? `${tr('catalog.summary.active_services')}: ${s.active_services}` : undefined} />
          <KpiTile label={tr('catalog.summary.total_stock_cost_value')} value={v(s?.total_stock_cost_value, true)} style={{ minWidth: '100%' }} />
          <KpiTile tone="success" label={tr('catalog.summary.total_stock_sale_value')} value={v(s?.total_stock_sale_value, true)} style={{ minWidth: '100%' }} />
        </View>
      )}

      <Section>
        <Group>
          <ListRow title={tr('layout.nav_catalog_products')} subtitle={tr('catalog.products.description')} left={<Package size={20} color={t.colors.primary} />} onPress={() => router.push('/catalog/products')} />
          <ListRow title={tr('layout.nav_catalog_services')} subtitle={tr('catalog.services.description')} left={<Wrench size={20} color={t.colors.primary} />} onPress={() => router.push('/catalog/services')} />
          <ListRow
            title={tr('layout.nav_catalog_categories')}
            subtitle={s ? `${tr('catalog.summary.total_categories')}: ${s.total_categories}` : tr('catalog.categories.description')}
            left={<Layers size={20} color={t.colors.primary} />}
            onPress={() => router.push('/catalog/categories')}
            last
          />
        </Group>
      </Section>
    </Screen>
  );
}
