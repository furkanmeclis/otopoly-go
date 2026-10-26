import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Badge, Button, Card, Divider, IconButton, Row, SelectField, Skeleton, Txt } from '@/components/ui';
import { catalogUnitLabel, normalizeDecimal } from '@/features/catalog/lib/units';
import { catalogService, type CatalogService, type ServiceProduct } from '@/features/catalog/services/catalog.service';
import { useProductSearch } from '@/features/catalog/queries';
import { qk, useServiceProducts } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

type Draft = { product_uuid: string; name: string; unit: string; qty: string; cost: string };

const toDraft = (p: ServiceProduct): Draft => ({ product_uuid: p.product_uuid, name: p.name, unit: p.unit, qty: p.qty, cost: p.cost_price });

/**
 * Web `ServiceProductsCard` — the recipe: products one unit of the service uses. Jobs take them
 * out of stock automatically. Owner edits the list (add via product search, change qty, remove) and saves it at once.
 */
export function ServiceRecipeCard({ service, canWrite }: { service: CatalogService; canWrite: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const qc = useQueryClient();
  const query = useServiceProducts(service.uuid);
  const saved = useMemo(() => query.data?.items ?? [], [query.data]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const products = useProductSearch(q, editing);

  const rows = editing ? draft : saved.map(toDraft);
  const cost = rows.reduce((sum, r) => sum + toNumber(r.qty) * toNumber(r.cost), 0);
  const price = toNumber(service.price);
  const money = (v: number) => fmt.money(v, service.currency);

  const options = (products.data?.items ?? [])
    .filter((p) => !draft.some((d) => d.product_uuid === p.uuid))
    .map((p) => ({
      value: p.uuid,
      label: p.sku ? `${p.name} · ${p.sku}` : p.name,
      description: p.track_stock ? `${tr('catalog.products.stock_quantity')}: ${fmt.number(p.stock_quantity, 3)} ${catalogUnitLabel(tr, p.unit)}` : undefined,
    }));

  const save = useApiMutation({
    key: 'catalog.services.recipe',
    fn: () => catalogService.setServiceProducts(service.uuid, draft.map((d) => ({ product_uuid: d.product_uuid, qty: d.qty }))),
    invalidate: [qk.catalog],
    success: tr('catalog.recipe.saved'),
    toastValidation: true,
    onSuccess: (res) => {
      qc.setQueryData([...qk.catalog, 'service-products', service.uuid], res);
      setEditing(false);
    },
  });

  const invalidQty = editing && draft.some((d) => !(toNumber(d.qty) > 0));

  return (
    <Card style={{ gap: t.spacing.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="heading" style={{ flex: 1 }}>
          {tr('catalog.recipe.title')}
        </Txt>
        <Badge size="sm" label={String(saved.length)} />
      </Row>
      <Txt variant="caption" tone="secondary">
        {tr('catalog.recipe.hint')}
      </Txt>

      {query.isLoading ? (
        <Skeleton height={44} />
      ) : rows.length === 0 ? (
        <Txt tone="secondary">{tr('catalog.recipe.empty')}</Txt>
      ) : (
        <View>
          {rows.map((r, i) => {
            const stock = saved.find((s) => s.product_uuid === r.product_uuid);
            return (
              <View key={r.product_uuid}>
                {i > 0 ? <Divider /> : null}
                <Row gap={t.spacing.sm} style={{ paddingVertical: t.spacing.sm }}>
                  <Pressable
                    style={{ flex: 1, gap: 2 }}
                    disabled={editing}
                    onPress={() => router.push(`/catalog/products/${r.product_uuid}`)}
                    accessibilityRole={editing ? undefined : 'link'}
                  >
                    <Txt variant="bodyStrong" tone={editing ? 'default' : 'primary'} numberOfLines={1}>
                      {r.name}
                    </Txt>
                    <Txt variant="caption" tone="muted" numberOfLines={1}>
                      {`${fmt.money(r.cost, service.currency)} / ${catalogUnitLabel(tr, r.unit)}${stock?.track_stock ? ` · ${tr('catalog.products.stock_quantity')}: ${fmt.number(stock.stock_quantity, 3)}` : ''}`}
                    </Txt>
                  </Pressable>
                  {editing ? (
                    <View style={{ width: 72 }}>
                      <QtyInput value={r.qty} label={tr('jobs.consumptions.qty')} onChange={(qty) => setDraft((prev) => prev.map((d, j) => (j === i ? { ...d, qty } : d)))} />
                    </View>
                  ) : (
                    <Txt variant="mono">{`${fmt.number(r.qty, 3)} ${catalogUnitLabel(tr, r.unit)}`}</Txt>
                  )}
                  <Txt variant="caption" style={{ minWidth: 72, textAlign: 'right', fontWeight: '700' }}>
                    {money(toNumber(r.qty) * toNumber(r.cost))}
                  </Txt>
                  {editing ? (
                    <IconButton variant="ghost" label={tr('common.delete')} icon={<Trash2 size={16} color={t.colors.danger} />} onPress={() => setDraft((prev) => prev.filter((_, j) => j !== i))} />
                  ) : null}
                </Row>
              </View>
            );
          })}
        </View>
      )}

      {editing ? (
        <SelectField
          value={null}
          options={options}
          placeholder={tr('jobs.consumptions.pick_product')}
          searchable
          onSearch={setSearch}
          loading={products.isFetching}
          onChange={(uuid) => {
            const p = (products.data?.items ?? []).find((x) => x.uuid === uuid);
            if (!p || draft.some((d) => d.product_uuid === p.uuid)) return;
            setDraft((prev) => [...prev, { product_uuid: p.uuid, name: p.name, unit: p.unit, qty: '1', cost: p.cost_price }]);
          }}
        />
      ) : null}

      {rows.length > 0 ? (
        <Row style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md, padding: t.spacing.md, justifyContent: 'space-between' }}>
          <Stat label={tr('catalog.recipe.cost')} value={money(cost)} />
          <Stat label={tr('catalog.services.price')} value={money(price)} />
          <Stat label={tr('jobs.consumptions.margin')} value={money(price - cost)} tone={price - cost >= 0 ? 'success' : 'danger'} />
        </Row>
      ) : null}

      {canWrite ? (
        editing ? (
          <Row gap={t.spacing.sm}>
            <Button style={{ flex: 1 }} variant="outline" label={tr('common.cancel')} onPress={() => setEditing(false)} />
            <Button style={{ flex: 1 }} label={tr('common.save')} loading={save.isPending} disabled={invalidQty} onPress={() => save.mutate(undefined)} />
          </Row>
        ) : (
          <Button
            variant="outline"
            size="sm"
            icon={<Plus size={16} color={t.colors.text} />}
            label={saved.length ? tr('catalog.recipe.edit') : tr('catalog.recipe.add')}
            onPress={() => {
              setDraft(saved.map(toDraft));
              setSearch('');
              setEditing(true);
            }}
          />
        )
      ) : null}
    </Card>
  );
}

function QtyInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={(v) => onChange(normalizeDecimal(v))}
      keyboardType="decimal-pad"
      inputMode="decimal"
      accessibilityLabel={label}
      selectTextOnFocus
      style={{
        height: 36,
        borderWidth: 1.5,
        borderColor: toNumber(value) > 0 ? t.colors.border : t.colors.danger,
        borderRadius: t.radius.sm,
        paddingHorizontal: t.spacing.sm,
        textAlign: 'right',
        color: t.colors.text,
        backgroundColor: t.colors.surface,
        fontVariant: ['tabular-nums'],
      }}
    />
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'danger' }) {
  return (
    <View style={{ gap: 2, flexShrink: 1 }}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <Txt variant="bodyStrong" tone={tone}>
        {value}
      </Txt>
    </View>
  );
}
