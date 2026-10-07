import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorState, Header, ListSkeleton, MoneyField, Row, Screen, SelectField, SwitchRow, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { CATALOG_WRITE } from '@/features/catalog/components/catalog-parts';
import { CATALOG_UNIT_KEYS, normalizeDecimal } from '@/features/catalog/lib/units';
import { useActiveCategories } from '@/features/catalog/queries';
import { catalogService, type CatalogProduct } from '@/features/catalog/services/catalog.service';
import { qk, useProduct } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function ProductFormScreen() {
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useProduct(id ?? '');
  return (
    <RequirePermission gate={CATALOG_WRITE} title={id ? tr('catalog.products.edit') : tr('catalog.products.new')}>
      {id && existing.isLoading ? (
        <Screen header={<Header title={tr('catalog.products.edit')} />}>
          <ListSkeleton rows={6} height={56} />
        </Screen>
      ) : id && (existing.isError || !existing.data) ? (
        <Screen header={<Header title={tr('catalog.products.edit')} />}>
          <ErrorState error={existing.error} description={tr('catalog.detail.product_not_found')} onRetry={() => existing.refetch()} />
        </Screen>
      ) : (
        <ProductForm key={existing.data?.uuid ?? 'new'} product={id ? (existing.data ?? null) : null} />
      )}
    </RequirePermission>
  );
}

/** Web `ProductDialog` fields and defaults (unit piece, VAT 20, track stock on, active on). */
function ProductForm({ product }: { product: CatalogProduct | null }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const editing = Boolean(product);
  const categories = useActiveCategories('product');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState<string | null>(product?.category_uuid ?? null);
  const [unit, setUnit] = useState(product?.unit || 'piece');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [cost, setCost] = useState(product?.cost_price || '0');
  const [sale, setSale] = useState(product?.sale_price || '0');
  const [vat, setVat] = useState(product?.vat_rate || '20');
  const [trackStock, setTrackStock] = useState(product?.track_stock ?? true);
  const [qty, setQty] = useState(product?.stock_quantity || '0');
  const [minAlert, setMinAlert] = useState(product?.min_stock_alert || '0');
  const [active, setActive] = useState(product?.is_active ?? true);
  const [description, setDescription] = useState(product?.description ?? '');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const categoryOptions = (categories.data?.items ?? []).map((c) => ({ value: c.uuid, label: c.name }));
  // Keep a now-inactive current category selectable.
  if (product?.category_uuid && !categoryOptions.some((o) => o.value === product.category_uuid)) {
    categoryOptions.unshift({ value: product.category_uuid, label: product.category_name ?? '—' });
  }

  const save = useApiMutation({
    key: editing ? 'catalog.products.update' : 'catalog.products.create',
    fn: () => {
      const body = {
        name: name.trim(),
        category_uuid: category,
        sku: sku.trim(),
        barcode: barcode.trim(),
        unit,
        cost_price: cost || '0',
        sale_price: sale || '0',
        vat_rate: vat || '0',
        currency: product?.currency || 'TRY',
        stock_quantity: qty || '0',
        min_stock_alert: minAlert || '0',
        track_stock: trackStock,
        is_active: active,
        description,
      };
      return editing ? catalogService.updateProduct(product!.uuid, body) : catalogService.createProduct(body);
    },
    invalidate: [qk.catalog],
    success: editing ? tr('catalog.products.updated_success') : tr('catalog.products.created_success'),
    onSuccess: (p) => (editing ? router.back() : router.replace(`/catalog/products/${p.uuid}`)),
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('form.required');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  return (
    <Screen
      header={<Header title={editing ? tr('catalog.products.edit') : tr('catalog.products.new')} subtitle={editing ? product!.name : tr('catalog.products.description')} />}
      footer={<Button label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" />}
    >
      <TextField label={tr('catalog.products.name')} placeholder={tr('catalog.products.name_placeholder')} value={name} onChangeText={setName} error={errs.name} required autoFocus={!editing} />
      <SelectField
        label={tr('catalog.products.category')}
        value={category}
        onChange={setCategory}
        options={categoryOptions}
        placeholder={tr('catalog.products.category_select')}
        loading={categories.isLoading}
        allowClear
        searchable={categoryOptions.length > 8}
        error={errs.category_uuid}
      />
      <SelectField
        label={tr('catalog.products.unit')}
        value={unit}
        onChange={(v) => setUnit(v ?? 'piece')}
        options={CATALOG_UNIT_KEYS.map((u) => ({ value: u, label: tr(`catalog.products.units.${u}`) }))}
        error={errs.unit}
      />
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <TextField label={tr('catalog.products.sku')} placeholder={tr('catalog.placeholders.sku')} value={sku} onChangeText={setSku} autoCapitalize="characters" error={errs.sku} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={tr('catalog.products.barcode')} placeholder={tr('catalog.placeholders.barcode')} value={barcode} onChangeText={setBarcode} keyboardType="number-pad" error={errs.barcode} />
        </View>
      </Row>
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <MoneyField label={tr('catalog.products.cost_price')} value={cost} onChangeText={setCost} error={errs.cost_price} />
        </View>
        <View style={{ flex: 1 }}>
          <MoneyField label={tr('catalog.products.sale_price')} value={sale} onChangeText={setSale} error={errs.sale_price} />
        </View>
      </Row>
      <TextField label={tr('catalog.products.vat_rate')} value={vat} onChangeText={(v) => setVat(normalizeDecimal(v))} keyboardType="decimal-pad" inputMode="decimal" error={errs.vat_rate} />

      <Card style={{ gap: t.spacing.md, backgroundColor: t.colors.surfaceAlt }}>
        <SwitchRow label={tr('catalog.products.track_stock')} value={trackStock} onValueChange={setTrackStock} />
        {trackStock ? (
          <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <TextField label={tr('catalog.products.stock_quantity')} value={qty} onChangeText={(v) => setQty(normalizeDecimal(v))} keyboardType="decimal-pad" inputMode="decimal" error={errs.stock_quantity} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={tr('catalog.products.min_stock_alert')} value={minAlert} onChangeText={(v) => setMinAlert(normalizeDecimal(v))} keyboardType="decimal-pad" inputMode="decimal" error={errs.min_stock_alert} />
            </View>
          </Row>
        ) : null}
        {editing && trackStock ? (
          <Txt variant="caption" tone="muted">
            {tr('mobile.catalog.stock_edit_hint')}
          </Txt>
        ) : null}
      </Card>

      <SwitchRow label={tr('catalog.products.is_active')} value={active} onValueChange={setActive} />
      <TextField label={tr('catalog.products.description_field')} value={description} onChangeText={setDescription} multiline error={errs.description} />
    </Screen>
  );
}
