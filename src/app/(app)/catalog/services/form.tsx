import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Header, ListSkeleton, MoneyField, Row, Screen, SelectField, SwitchRow, TextField } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { CATALOG_WRITE } from '@/features/catalog/components/catalog-parts';
import { ServiceColorPicker } from '@/features/catalog/components/service-color-picker';
import { normalizeDecimal } from '@/features/catalog/lib/units';
import { useActiveCategories } from '@/features/catalog/queries';
import { catalogService, type CatalogService } from '@/features/catalog/services/catalog.service';
import { qk, useService } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function ServiceFormScreen() {
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useService(id ?? '');
  return (
    <RequirePermission gate={CATALOG_WRITE} title={id ? tr('catalog.services.edit') : tr('catalog.services.new')}>
      {id && existing.isLoading ? (
        <Screen header={<Header title={tr('catalog.services.edit')} />}>
          <ListSkeleton rows={6} height={56} />
        </Screen>
      ) : (
        <ServiceForm key={existing.data?.uuid ?? 'new'} service={id ? (existing.data ?? null) : null} />
      )}
    </RequirePermission>
  );
}

/** Web `ServiceDialog`: name, category, code, duration (≥1, default 30), price, VAT, colour tag, active, description. */
function ServiceForm({ service }: { service: CatalogService | null }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const editing = Boolean(service);
  const categories = useActiveCategories('service');
  const [name, setName] = useState(service?.name ?? '');
  const [category, setCategory] = useState<string | null>(service?.category_uuid ?? null);
  const [code, setCode] = useState(service?.code ?? '');
  const [duration, setDuration] = useState(String(service?.duration_minutes ?? 30));
  const [price, setPrice] = useState(service?.price || '0');
  const [vat, setVat] = useState(service?.vat_rate || '20');
  const [color, setColor] = useState(service?.color ?? '');
  const [active, setActive] = useState(service?.is_active ?? true);
  const [description, setDescription] = useState(service?.description ?? '');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const categoryOptions = (categories.data?.items ?? []).map((c) => ({ value: c.uuid, label: c.name }));
  if (service?.category_uuid && !categoryOptions.some((o) => o.value === service.category_uuid)) {
    categoryOptions.unshift({ value: service.category_uuid, label: service.category_name ?? '—' });
  }

  const save = useApiMutation({
    key: editing ? 'catalog.services.update' : 'catalog.services.create',
    fn: () => {
      const body = {
        name: name.trim(),
        category_uuid: category,
        code: code.trim(),
        duration_minutes: Number(duration),
        price: price || '0',
        vat_rate: vat || '0',
        currency: service?.currency || 'TRY',
        is_active: active,
        description,
        color,
      };
      return editing ? catalogService.updateService(service!.uuid, body) : catalogService.createService(body);
    },
    invalidate: [qk.catalog, qk.jobs],
    success: editing ? tr('catalog.services.updated_success') : tr('catalog.services.created_success'),
    onSuccess: (s) => (editing ? router.back() : router.replace(`/catalog/services/${s.uuid}`)),
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('form.required');
    if (!(Number(duration) >= 1)) e.duration_minutes = tr('mobile.catalog.duration_min');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  return (
    <Screen
      header={<Header title={editing ? tr('catalog.services.edit') : tr('catalog.services.new')} subtitle={editing ? service!.name : tr('catalog.services.description')} />}
      footer={<Button label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" />}
    >
      <TextField label={tr('catalog.services.name')} placeholder={tr('catalog.services.name_placeholder')} value={name} onChangeText={setName} error={errs.name} required autoFocus={!editing} />
      <SelectField
        label={tr('catalog.services.category')}
        value={category}
        onChange={setCategory}
        options={categoryOptions}
        placeholder={tr('catalog.services.category_select')}
        loading={categories.isLoading}
        allowClear
        searchable={categoryOptions.length > 8}
        error={errs.category_uuid}
      />
      <TextField label={tr('catalog.services.code')} placeholder={tr('catalog.placeholders.service_code')} value={code} onChangeText={setCode} autoCapitalize="characters" error={errs.code} />
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <TextField label={tr('catalog.services.duration')} value={duration} onChangeText={(v) => setDuration(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" error={errs.duration_minutes} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={tr('catalog.services.vat_rate')} value={vat} onChangeText={(v) => setVat(normalizeDecimal(v))} keyboardType="decimal-pad" inputMode="decimal" error={errs.vat_rate} />
        </View>
      </Row>
      <MoneyField label={tr('catalog.services.price')} value={price} onChangeText={setPrice} error={errs.price} />
      <ServiceColorPicker value={color} name={name} onChange={setColor} />
      <SwitchRow label={tr('catalog.services.is_active')} value={active} onValueChange={setActive} />
      <TextField label={tr('catalog.services.description_field')} value={description} onChangeText={setDescription} multiline error={errs.description} />
    </Screen>
  );
}
