/**
 * Shared building blocks for the commerce screens (sales, purchases, cari):
 * day switcher + summary strip (web DaySummaryBar), status badges, product picker and
 * editable draft lines (web quick-sale / create-purchase dialogs).
 */
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Badge, Card, DateField, IconButton, Row, SelectField, TextField, Txt, type Tone } from '@/components/ui';
import type { CatalogProduct } from '@/features/catalog/services/catalog.service';
import type { Customer } from '@/features/customers/services/customers.service';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { useCustomersSearch } from '@/features/queries';
import { useProductSearch } from '@/features/sales/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

// ─── Day switcher + stats ───────────────────────────────────────────────────

export function DaySwitcher({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const isToday = date >= localToday();
  return (
    <Row gap={t.spacing.sm}>
      <IconButton label={tr('mobile.common.previous_day')} icon={<ChevronLeft size={20} color={t.colors.text} />} onPress={() => onChange(shiftDate(date, -1))} />
      <View style={{ flex: 1 }}>
        <DateField value={date} onChange={(v) => v && onChange(v)} maximumDate={new Date()} />
      </View>
      <IconButton label={tr('mobile.common.next_day')} icon={<ChevronRight size={20} color={t.colors.text} />} onPress={() => onChange(shiftDate(date, 1))} disabled={isToday} />
    </Row>
  );
}

export type Stat = { label: string; value: string; accent?: boolean };

export function StatStrip({ stats, loading }: { stats: Stat[]; loading?: boolean }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
      {stats.map((st) => (
        <View
          key={st.label}
          accessible
          accessibilityLabel={`${st.label}: ${st.value}`}
          style={{
            minWidth: 110,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.sm,
            borderRadius: t.radius.md,
            backgroundColor: st.accent ? t.colors.primarySoft : t.colors.surface,
            borderWidth: 1,
            borderColor: st.accent ? t.colors.primarySoft : t.colors.border,
          }}
        >
          <Txt variant="caption" tone={st.accent ? 'primary' : 'secondary'} numberOfLines={1}>
            {st.label}
          </Txt>
          <Txt variant="bodyStrong" tone={st.accent ? 'primary' : 'default'} style={{ fontVariant: ['tabular-nums'] }}>
            {loading ? '…' : st.value}
          </Txt>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Status badges ──────────────────────────────────────────────────────────

/** posted → success, voided → danger (web `statusTone` for sales and purchases). */
export function DocStatusBadge({ status, ns, size = 'sm' }: { status: 'draft' | 'posted' | 'voided'; ns: 'sales' | 'purchases'; size?: 'sm' | 'md' }) {
  const { t: tr } = useLocale();
  const tone: Tone = status === 'posted' ? 'success' : status === 'voided' ? 'danger' : status === 'draft' ? 'warning' : 'neutral';
  return <Badge size={size} tone={tone} label={tr(`${ns}.status.${status}`)} />;
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/** Keeps a decimal string ("1.5") from free keyboard input; accepts "," too. */
export function sanitizeDecimal(raw: string, maxDecimals = 3) {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const [int, ...dec] = cleaned.split('.');
  return dec.length ? `${int}.${dec.join('').slice(0, maxDecimals)}` : int;
}

/** Default finance account like the web dialogs: the default account, else the first one. */
export function defaultAccountUuid(accounts: { uuid: string; is_default: boolean }[]) {
  return accounts.find((a) => a.is_default)?.uuid ?? accounts[0]?.uuid ?? null;
}

// ─── Product picker ─────────────────────────────────────────────────────────

/**
 * "Add product…" search sheet. Already added products are hidden (web `hideSelected`).
 * Sales show the sale price and stock; purchases show the cost price.
 */
export function ProductPicker({
  mode,
  selected,
  onAdd,
  error,
}: {
  mode: 'sale' | 'purchase';
  selected: string[];
  onAdd: (product: CatalogProduct) => void;
  error?: string | null;
}) {
  const { t: tr, fmt } = useLocale();
  const ns = mode === 'sale' ? 'sales' : 'purchases';
  const [q, setQ] = useState('');
  const search = useProductSearch(q);
  const items = useMemo(() => (search.data?.items ?? []).filter((p) => !selected.includes(p.uuid)), [search.data, selected]);
  const options = useMemo(
    () =>
      items.map((p) => {
        const price = fmt.money(mode === 'sale' ? p.sale_price : p.cost_price, p.currency);
        const stock = p.track_stock ? tr('mobile.commerce.stock_available', { qty: fmt.number(p.stock_quantity, 3), unit: p.unit || '' }).trim() : tr('catalog.stock_status.untracked');
        return {
          value: p.uuid,
          label: p.sku ? `${p.name} · ${p.sku}` : p.name,
          description: `${price} · ${stock}`,
          left: mode === 'sale' && p.track_stock && toNumber(p.stock_quantity) <= 0 ? <Badge size="sm" tone="danger" label={tr('catalog.stock_status.out_of_stock')} /> : undefined,
        };
      }),
    [items, mode, fmt, tr],
  );
  return (
    <SelectField
      label={tr(`${ns}.products`)}
      placeholder={tr(`${ns}.pick_product`)}
      value={null}
      options={options}
      onSearch={setQ}
      loading={search.isFetching}
      error={error}
      onChange={(v) => {
        const product = items.find((p) => p.uuid === v);
        if (product) onAdd(product);
      }}
    />
  );
}

// ─── Draft lines ────────────────────────────────────────────────────────────

export type DraftLine = {
  key: string;
  product_uuid: string;
  name: string;
  /** unit_price for sales, unit_cost for purchases. */
  price: string;
  qty: string;
  currency: string;
  /** Stock info at pick time (sales only warn; the server has the final say). */
  track_stock: boolean;
  stock_quantity: string;
  unit: string;
};

export function draftFromProduct(p: CatalogProduct, mode: 'sale' | 'purchase'): DraftLine {
  return {
    key: `${p.uuid}-${Date.now()}`,
    product_uuid: p.uuid,
    name: p.name,
    price: mode === 'sale' ? p.sale_price : p.cost_price,
    qty: '1',
    currency: p.currency,
    track_stock: p.track_stock,
    stock_quantity: p.stock_quantity,
    unit: p.unit,
  };
}

export const draftTotal = (lines: DraftLine[]) => lines.reduce((s, l) => s + toNumber(l.price) * toNumber(l.qty), 0);

export function DraftLines({
  mode,
  lines,
  onChange,
  onRemove,
}: {
  mode: 'sale' | 'purchase';
  lines: DraftLine[];
  onChange: (key: string, patch: Partial<Pick<DraftLine, 'qty' | 'price'>>) => void;
  onRemove: (key: string) => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const ns = mode === 'sale' ? 'sales' : 'purchases';
  if (lines.length === 0) {
    return (
      <Txt variant="caption" tone="secondary">
        {tr(mode === 'sale' ? 'sales.quick.lines_hint' : 'purchases.create.lines_hint')}
      </Txt>
    );
  }
  return (
    <View style={{ gap: t.spacing.sm }}>
      {lines.map((line) => {
        const short = mode === 'sale' && line.track_stock && toNumber(line.qty) > toNumber(line.stock_quantity);
        return (
          <Card key={line.key} style={{ gap: t.spacing.sm }}>
            <Row gap={t.spacing.sm}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={2}>
                  {line.name}
                </Txt>
                {mode === 'sale' ? (
                  <Txt variant="caption" tone={short ? 'danger' : 'secondary'}>
                    {line.track_stock
                      ? short
                        ? tr('mobile.commerce.stock_insufficient', { qty: fmt.number(line.stock_quantity, 3) })
                        : tr('mobile.commerce.stock_available', { qty: fmt.number(line.stock_quantity, 3), unit: line.unit || '' }).trim()
                      : tr('catalog.stock_status.untracked')}
                  </Txt>
                ) : null}
              </View>
              <IconButton variant="ghost" label={tr('common.delete')} icon={<Trash2 size={18} color={t.colors.danger} />} onPress={() => onRemove(line.key)} />
            </Row>
            <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
              <View style={{ width: 96 }}>
                <TextField
                  label={tr(`${ns}.qty`)}
                  value={line.qty}
                  onChangeText={(v) => onChange(line.key, { qty: sanitizeDecimal(v) })}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel={`${line.name} ${tr(`${ns}.qty`)}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label={tr(mode === 'sale' ? 'sales.unit_price' : 'purchases.unit_cost')}
                  value={line.price}
                  onChangeText={(v) => onChange(line.key, { price: sanitizeDecimal(v, 2) })}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel={`${line.name} ${tr(mode === 'sale' ? 'sales.unit_price' : 'purchases.unit_cost')}`}
                  right={
                    <Txt tone="muted" style={{ fontWeight: '700' }}>
                      ₺
                    </Txt>
                  }
                />
              </View>
            </Row>
            <Row style={{ justifyContent: 'flex-end' }}>
              <Txt variant="mono" tone="secondary">
                {fmt.money(toNumber(line.price) * toNumber(line.qty), line.currency)}
              </Txt>
            </Row>
          </Card>
        );
      })}
    </View>
  );
}

/** Label + total row under the lines (web "Toplam" row). */
export function TotalRow({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', paddingHorizontal: t.spacing.xs }}>
      <Txt tone="secondary">{label}</Txt>
      <Txt variant="title" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Txt>
    </Row>
  );
}

// ─── Optional customer (quick sale) ─────────────────────────────────────────

/** Clearable customer search (web quick-sale customer combobox — no inline create). */
export function OptionalCustomerPicker({ value, onChange, error }: { value: Customer | null; onChange: (c: Customer | null) => void; error?: string | null }) {
  const { t: tr } = useLocale();
  const [q, setQ] = useState('');
  const search = useCustomersSearch(q);
  const merged = useMemo(() => {
    const items = search.data?.items ?? [];
    return value && !items.some((c) => c.uuid === value.uuid) ? [value, ...items] : items;
  }, [search.data, value]);
  return (
    <SelectField
      label={tr('sales.customer')}
      placeholder={tr('sales.pick_customer')}
      value={value?.uuid ?? null}
      onChange={(v) => onChange(v ? (merged.find((c) => c.uuid === v) ?? null) : null)}
      options={merged.map((c) => ({ value: c.uuid, label: c.name, description: c.phone || undefined }))}
      onSearch={setQ}
      loading={search.isFetching}
      error={error}
      allowClear
    />
  );
}
