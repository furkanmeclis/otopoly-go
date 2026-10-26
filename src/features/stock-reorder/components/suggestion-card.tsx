import { router } from 'expo-router';
import { ChevronDown, ChevronUp, Square, SquareCheck, Truck } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Card, Row, Txt } from '@/components/ui';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { stockFill, urgencyTone } from '../lib/reorder';
import type { ReorderSuggestion } from '../types';
import { QtyStepper } from './qty-stepper';

const SOURCE_KEYS = {
  product: 'stock_reorder.explain.source_product',
  supplier: 'stock_reorder.explain.source_supplier',
  organization: 'stock_reorder.explain.source_organization',
} as const;

export const URGENCY_KEYS = {
  out_of_stock: 'stock_reorder.urgency.out_of_stock',
  below_min: 'stock_reorder.urgency.below_min',
  low_cover: 'stock_reorder.urgency.low_cover',
  none: 'stock_reorder.urgency.none',
} as const;

type Props = {
  item: ReorderSuggestion;
  qty: string;
  selected: boolean;
  canWrite: boolean;
  onToggle: (uuid: string) => void;
  onQty: (uuid: string, qty: string) => void;
  onSettings: (item: ReorderSuggestion) => void;
};

/** One suggestion: urgency, stock vs minimum, usage, supplier, quantity stepper and the formula inputs. */
export const SuggestionCard = memo(function SuggestionCard({ item, qty, selected, canWrite, onToggle, onQty, onSettings }: Props) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [open, setOpen] = useState(false);
  const tone = urgencyTone(item.urgency);
  const barColor = tone === 'danger' ? t.colors.danger : tone === 'warning' ? t.colors.warning : t.colors.success;
  const q = (v: string) => fmt.number(v, 3);
  const total = toNumber(qty) * toNumber(item.unit_cost);

  return (
    <Card style={{ gap: t.spacing.sm, borderColor: selected ? t.colors.primary : undefined }}>
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
        {canWrite ? (
          <Pressable
            onPress={() => onToggle(item.product_uuid)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={item.name}
            hitSlop={10}
            style={{ paddingTop: 2 }}
          >
            {selected ? <SquareCheck size={24} color={t.colors.primary} /> : <Square size={24} color={t.colors.textMuted} />}
          </Pressable>
        ) : null}
        <Pressable style={{ flex: 1 }} onPress={() => router.push(`/catalog/products/${item.product_uuid}`)} accessibilityRole="link">
          <Txt variant="bodyStrong" numberOfLines={2}>
            {item.name}
          </Txt>
          {item.sku ? (
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {item.sku}
            </Txt>
          ) : null}
        </Pressable>
        <Badge size="sm" tone={tone} label={tr(URGENCY_KEYS[item.urgency])} />
      </Row>

      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="caption" tone={toNumber(item.stock) <= 0 ? 'danger' : 'default'} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {tr('mobile.reorder.stock_line', { stock: q(item.stock), unit: item.unit })}
          </Txt>
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {tr('stock_reorder.min_short', { value: q(item.min_stock) })}
          </Txt>
        </Row>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no">
          <View style={{ width: `${Math.round(stockFill(item) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: barColor }} />
        </View>
        <Txt variant="caption" tone="secondary" numberOfLines={2}>
          {tr('stock_reorder.per_day', { value: q(item.velocity_per_day) })}
          {' · '}
          {item.days_of_cover === null ? tr('stock_reorder.no_usage') : tr('stock_reorder.cover_days', { value: fmt.number(item.days_of_cover, 1) })}
          {toNumber(item.on_order) > 0 ? ` · ${tr('mobile.reorder.on_order', { qty: q(item.on_order) })}` : ''}
        </Txt>
      </View>

      <Pressable onPress={() => canWrite && onSettings(item)} disabled={!canWrite} accessibilityRole="button" accessibilityLabel={tr('stock_reorder.override.title')}>
        <Row gap={t.spacing.xs}>
          <Truck size={14} color={item.supplier ? t.colors.textSecondary : t.colors.warning} />
          <Txt variant="caption" tone={item.supplier ? 'secondary' : 'warning'} numberOfLines={1} style={{ flex: 1 }}>
            {item.supplier
              ? `${item.supplier.name} · ${tr(item.supplier.source === 'product' ? 'stock_reorder.supplier_source.product' : 'stock_reorder.supplier_source.last_purchase')}`
              : canWrite
                ? tr('stock_reorder.set_supplier')
                : tr('stock_reorder.no_supplier')}
          </Txt>
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt.money(item.unit_cost, item.currency)}
          </Txt>
        </Row>
      </Pressable>

      <Row style={{ justifyContent: 'space-between' }} gap={t.spacing.sm}>
        {canWrite ? (
          <QtyStepper value={qty} onChange={(v) => onQty(item.product_uuid, v)} packSize={item.pack_size} label={`${item.name} ${tr('stock_reorder.columns.suggested')}`} />
        ) : (
          <Txt variant="bodyStrong">{tr('mobile.reorder.suggested_line', { qty: q(item.suggested_qty), unit: item.unit })}</Txt>
        )}
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt.money(total, item.currency)}
          </Txt>
          {item.pack_size ? (
            <Txt variant="caption" tone="muted">
              {tr('stock_reorder.packs', { count: item.packs ?? 0, size: q(item.pack_size) })}
            </Txt>
          ) : null}
        </View>
      </Row>

      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6}>
        <Row gap={t.spacing.xs}>
          {open ? <ChevronUp size={14} color={t.colors.primary} /> : <ChevronDown size={14} color={t.colors.primary} />}
          <Txt variant="caption" tone="primary">
            {tr('stock_reorder.explain.title')}
          </Txt>
        </Row>
      </Pressable>
      {open ? (
        <View style={{ gap: 2, padding: t.spacing.sm, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceAlt }}>
          {(
            [
              [tr('stock_reorder.explain.usage', { days: item.inputs.velocity_days }), tr('stock_reorder.explain.usage_value', { consumed: q(item.inputs.consumed_qty), sold: q(item.inputs.sold_qty) })],
              [tr('stock_reorder.explain.lead'), `${item.inputs.lead_days} · ${tr(SOURCE_KEYS[item.inputs.lead_days_source])}`],
              [tr('stock_reorder.explain.target'), `${item.inputs.target_days} · ${tr(SOURCE_KEYS[item.inputs.target_days_source])}`],
              [tr('stock_reorder.explain.demand'), q(item.inputs.demand_qty)],
              [tr('stock_reorder.explain.on_order'), q(item.on_order)],
              [tr('stock_reorder.explain.raw_need'), q(item.inputs.raw_need)],
            ] as const
          ).map(([label, value]) => (
            <Row key={label} style={{ justifyContent: 'space-between' }} gap={t.spacing.sm}>
              <Txt variant="caption" tone="secondary" style={{ flexShrink: 1 }}>
                {label}
              </Txt>
              <Txt variant="caption" style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                {value}
              </Txt>
            </Row>
          ))}
          <Txt variant="caption" tone="muted" style={{ marginTop: 4 }}>
            {tr('stock_reorder.explain.formula')}
          </Txt>
        </View>
      ) : null}
    </Card>
  );
});
