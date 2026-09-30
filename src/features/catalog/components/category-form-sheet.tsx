import { useState } from 'react';
import { View } from 'react-native';

import { Button, Segmented, SelectField, Sheet, SwitchRow, TextField, Txt } from '@/components/ui';
import { useActiveCategories } from '@/features/catalog/queries';
import { catalogService, type CatalogCategory } from '@/features/catalog/services/catalog.service';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

type Kind = CatalogCategory['kind'];

/** Web `CategoryDialog` (create / edit): name, kind, parent (same kind, not itself), sort order, active. */
export function CategoryFormSheet({
  visible,
  onClose,
  category,
  defaultKind = 'product',
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  category?: CatalogCategory | null;
  defaultKind?: Kind;
  onSaved?: (c: CatalogCategory) => void;
}) {
  if (!visible) return null;
  return <CategoryForm key={category?.uuid ?? `new-${defaultKind}`} category={category ?? null} defaultKind={defaultKind} onClose={onClose} onSaved={onSaved} />;
}

function CategoryForm({ category, defaultKind, onClose, onSaved }: { category: CatalogCategory | null; defaultKind: Kind; onClose: () => void; onSaved?: (c: CatalogCategory) => void }) {
  const { t: tr } = useLocale();
  const editing = Boolean(category);
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<Kind>(category?.kind ?? defaultKind);
  const [parent, setParent] = useState<string | null>(category?.parent_uuid ?? null);
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0));
  const [active, setActive] = useState(category?.is_active ?? true);
  const [nameError, setNameError] = useState<string | null>(null);
  const all = useActiveCategories();

  const parentOptions = (all.data?.items ?? []).filter((c) => c.kind === kind && c.uuid !== category?.uuid).map((c) => ({ value: c.uuid, label: c.name }));

  const save = useApiMutation({
    key: editing ? 'catalog.categories.update' : 'catalog.categories.create',
    fn: () => {
      const body = { name: name.trim(), kind, parent_uuid: parent, sort_order: Number(sortOrder) || 0, is_active: active };
      return editing ? catalogService.updateCategory(category!.uuid, body) : catalogService.createCategory(body);
    },
    invalidate: [qk.catalog],
    success: editing ? tr('catalog.categories.updated_success') : tr('catalog.categories.created_success'),
    onSuccess: (c) => {
      onSaved?.(c);
      onClose();
    },
  });
  const errs = fieldErrors(save.error);

  const submit = () => {
    if (!name.trim()) return setNameError(tr('form.required'));
    setNameError(null);
    save.mutate(undefined);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={editing ? tr('catalog.categories.edit') : tr('catalog.categories.new')}
      footer={<Button size="lg" label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={submit} />}
    >
      <Txt variant="caption" tone="secondary">
        {tr('catalog.categories.description')}
      </Txt>
      <TextField label={tr('catalog.categories.name')} placeholder={tr('catalog.placeholders.category_name')} value={name} onChangeText={setName} error={nameError ?? errs.name} required autoFocus={!editing} />
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('catalog.categories.kind')}
        </Txt>
        <Segmented<Kind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            setParent(null);
          }}
          options={[
            { value: 'product', label: tr('catalog.categories.kind_product') },
            { value: 'service', label: tr('catalog.categories.kind_service') },
          ]}
        />
      </View>
      <SelectField
        label={tr('catalog.categories.parent')}
        value={parent}
        onChange={(v) => setParent(v)}
        options={parentOptions}
        placeholder={tr('catalog.categories.no_parent')}
        allowClear
        searchable={parentOptions.length > 8}
        loading={all.isLoading}
        error={errs.parent_uuid}
      />
      <TextField label={tr('catalog.categories.sort_order')} value={sortOrder} onChangeText={(v) => setSortOrder(v.replace(/[^0-9-]/g, ''))} keyboardType="number-pad" error={errs.sort_order} />
      <SwitchRow label={tr('catalog.categories.is_active')} value={active} onValueChange={setActive} />
    </Sheet>
  );
}
