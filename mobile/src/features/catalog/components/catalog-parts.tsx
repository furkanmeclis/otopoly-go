import { Clock } from 'lucide-react-native';
import { View } from 'react-native';

import { Badge, Card, Dot, Row, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { ownerOnly, P } from '@/features/auth/permissions';
import { serviceSwatch } from '@/features/catalog/lib/service-colors';
import { catalogUnitLabel } from '@/features/catalog/lib/units';
import type { CatalogProduct, CatalogService } from '@/features/catalog/services/catalog.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Web `useTenantCatalogAccess`: writes need the owner membership + `tenant.catalog.write`. */
export const CATALOG_WRITE = ownerOnly(P.catalogWrite);

export function useCatalogAccess() {
  const { can } = useAuth();
  return { canRead: can(P.catalogRead), canWrite: can(CATALOG_WRITE) };
}

const STOCK_TONE = { in_stock: 'success', low_stock: 'warning', out_of_stock: 'danger', untracked: 'neutral' } as const;

export function StockBadge({ status, size = 'sm' }: { status: CatalogProduct['stock_status']; size?: 'sm' | 'md' }) {
  const { t: tr } = useLocale();
  return <Badge size={size} tone={STOCK_TONE[status] ?? 'neutral'} label={tr(`catalog.stock_status.${status}`)} />;
}

export function ActiveBadge({ active, size = 'sm' }: { active: boolean; size?: 'sm' | 'md' }) {
  const { t: tr } = useLocale();
  return <Badge size={size} tone={active ? 'success' : 'neutral'} label={active ? tr('common.active') : tr('common.passive')} />;
}

export function ServiceDot({ service, size = 10 }: { service: Pick<CatalogService, 'color' | 'name'>; size?: number }) {
  const t = useTheme();
  return <Dot color={serviceSwatch(service.color, service.name, t.scheme).solid} size={size} />;
}

/** Product list row (web products table columns: name/sku/barcode, category, unit, prices, stock, status). */
export function ProductCard({ product: p, onPress }: { product: CatalogProduct; onPress: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const ids = [p.sku ? `${tr('catalog.products.sku')}: ${p.sku}` : '', p.barcode ? `${tr('catalog.products.barcode')}: ${p.barcode}` : ''].filter(Boolean).join(' • ');
  return (
    <Card onPress={onPress} style={{ gap: t.spacing.sm, paddingVertical: t.spacing.md }} accessibilityLabel={p.name}>
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1} tone={p.is_active ? 'default' : 'muted'}>
            {p.name}
          </Txt>
          {ids ? (
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {ids}
            </Txt>
          ) : null}
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {`${p.category_name || '—'} · ${catalogUnitLabel(tr, p.unit)}`}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt variant="mono">{fmt.money(p.sale_price, p.currency)}</Txt>
          {Number(p.cost_price) > 0 ? (
            <Txt variant="caption" tone="muted">
              {`${tr('catalog.products.cost_price')}: ${fmt.money(p.cost_price, p.currency)}`}
            </Txt>
          ) : null}
        </View>
      </Row>
      <Row gap={t.spacing.sm} wrap>
        {p.track_stock ? (
          <Txt variant="caption" style={{ fontWeight: '700' }}>
            {`${fmt.number(p.stock_quantity, 3)} ${catalogUnitLabel(tr, p.unit)}`}
          </Txt>
        ) : null}
        <StockBadge status={p.track_stock ? p.stock_status : 'untracked'} />
        {!p.is_active ? <ActiveBadge active={false} /> : null}
      </Row>
    </Card>
  );
}

/** Service list row (web services table: colour + name/code, category, duration, price + VAT, status). */
export function ServiceCard({ service: s, onPress }: { service: CatalogService; onPress: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  return (
    <Card onPress={onPress} style={{ gap: t.spacing.xs, paddingVertical: t.spacing.md }} accessibilityLabel={s.name}>
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
        <View style={{ paddingTop: 6 }}>
          <ServiceDot service={s} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1} tone={s.is_active ? 'default' : 'muted'}>
            {s.name}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {[s.code ? `${tr('catalog.services.code')}: ${s.code}` : '', s.category_name || '—'].filter(Boolean).join(' · ')}
          </Txt>
          <Row gap={4}>
            <Clock size={12} color={t.colors.textMuted} />
            <Txt variant="caption" tone="muted">
              {tr('catalog.services.duration_value', { minutes: s.duration_minutes })}
            </Txt>
            {!s.is_active ? <ActiveBadge active={false} /> : null}
          </Row>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt variant="mono">{fmt.money(s.price, s.currency)}</Txt>
          <Txt variant="caption" tone="muted">
            {tr('catalog.services.vat_suffix', { rate: s.vat_rate })}
          </Txt>
        </View>
      </Row>
    </Card>
  );
}
