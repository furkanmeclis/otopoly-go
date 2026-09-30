import { useState } from 'react';
import { View } from 'react-native';

import { Button, Segmented, Sheet, SwitchRow, TextField, Txt } from '@/components/ui';
import { financeService, type FinanceCategory } from '@/features/finance/services/finance.service';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

const log = createLogger('screen.finance.category-sheet');

/**
 * Create a category (web `FinanceCategoryDialog`: name + kind) or edit one
 * (backend PATCH: name, sort_order, is_active — kind is fixed after creation).
 */
export function CategorySheet({
  visible,
  onClose,
  category,
  defaultKind = 'expense',
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  category?: FinanceCategory | null;
  defaultKind?: 'income' | 'expense';
  onSaved?: (c: FinanceCategory) => void;
}) {
  if (!visible) return null;
  return <CategorySheetContent onClose={onClose} category={category ?? null} defaultKind={defaultKind} onSaved={onSaved} />;
}

function CategorySheetContent({
  onClose,
  category,
  defaultKind,
  onSaved,
}: {
  onClose: () => void;
  category: FinanceCategory | null;
  defaultKind: 'income' | 'expense';
  onSaved?: (c: FinanceCategory) => void;
}) {
  const { t: tr } = useLocale();
  const editing = Boolean(category);
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<'income' | 'expense'>(category?.kind ?? defaultKind);
  const [sortOrder, setSortOrder] = useState(category ? String(category.sort_order) : '');
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useApiMutation({
    key: editing ? 'finance.category.update' : 'finance.category.create',
    fn: () =>
      category
        ? financeService.patchCategory(category.uuid, { name: name.trim(), sort_order: Number(sortOrder) || 0, is_active: isActive })
        : financeService.createCategory({ name: name.trim(), kind }),
    invalidate: [qk.finance, qk.reports],
    success: editing ? tr('mobile.finance.category_updated') : tr('mobile.finance.category_created'),
    onSuccess: (c) => {
      log.info(editing ? 'category updated' : 'category created', { uuid: c.uuid });
      onSaved?.(c);
      onClose();
    },
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('finance.categories.validation.name');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={editing ? tr('mobile.finance.edit_category') : tr('finance.categories.create')}
      footer={<Button label={save.isPending ? tr('common.loading') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" />}
    >
      {!editing ? (
        <Txt variant="caption" tone="secondary">
          {tr('finance.categories.create_description')}
        </Txt>
      ) : null}
      <TextField
        label={tr('finance.categories.name')}
        placeholder={tr('finance.categories.name_placeholder')}
        value={name}
        onChangeText={setName}
        error={errs.name}
        required
        autoFocus={!editing}
      />
      {editing ? (
        <>
          <TextField label={tr('finance.categories.sort_order')} value={sortOrder} onChangeText={(v) => setSortOrder(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" error={errs.sort_order} />
          <SwitchRow label={tr('finance.categories.is_active')} value={isActive} onValueChange={setIsActive} />
        </>
      ) : (
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('finance.categories.kind')}
          </Txt>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'income', label: tr('finance.categories.kind_income') },
              { value: 'expense', label: tr('finance.categories.kind_expense') },
            ]}
          />
        </View>
      )}
    </Sheet>
  );
}
