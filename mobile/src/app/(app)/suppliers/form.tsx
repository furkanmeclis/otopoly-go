import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorState, Header, ListSkeleton, Screen, SwitchRow, TextField } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { qk, useSupplier } from '@/features/queries';
import { suppliersService, type Supplier } from '@/features/suppliers/services/suppliers.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

const log = createLogger('screen.supplier_form');

export default function SupplierFormScreen() {
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useSupplier(id ?? '');
  return (
    <RequirePermission gate={{ perm: P.suppliersWrite, owner: true }} title={id ? tr('suppliers.dialog.edit_title') : tr('suppliers.dialog.create_title')}>
      {id && existing.isLoading ? (
        <Screen header={<Header title={tr('suppliers.dialog.edit_title')} />}>
          <ListSkeleton rows={5} height={56} />
        </Screen>
      ) : id && (existing.isError || !existing.data) ? (
        <Screen header={<Header title={tr('suppliers.dialog.edit_title')} />}>
          <ErrorState error={existing.error} description={tr('suppliers.error_description')} onRetry={() => existing.refetch()} />
        </Screen>
      ) : (
        <SupplierForm key={existing.data?.uuid ?? 'new'} supplier={id ? (existing.data ?? null) : null} />
      )}
    </RequirePermission>
  );
}

/** Web `SupplierDialog` (create + edit). */
function SupplierForm({ supplier }: { supplier: Supplier | null }) {
  const { t: tr } = useLocale();
  const editing = Boolean(supplier);
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [taxId, setTaxId] = useState(supplier?.tax_id ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [active, setActive] = useState(supplier?.is_active ?? true);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useApiMutation({
    key: editing ? 'suppliers.update' : 'suppliers.create',
    fn: () => {
      const body = { name: name.trim(), phone: phone.trim(), email: email.trim(), tax_id: taxId.trim(), notes, is_active: active };
      return editing ? suppliersService.update(supplier!.uuid, body) : suppliersService.create(body);
    },
    invalidate: [qk.suppliers, qk.purchases],
    success: editing ? tr('suppliers.toast.updated') : tr('suppliers.toast.created'),
    onSuccess: (s) => {
      log.info(editing ? 'supplier updated' : 'supplier created', { uuid: s.uuid });
      if (editing) router.back();
      else router.replace(`/suppliers/${s.uuid}`);
    },
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
      header={<Header title={editing ? tr('suppliers.dialog.edit_title') : tr('suppliers.dialog.create_title')} subtitle={editing ? supplier!.name : tr('suppliers.dialog.description')} />}
      footer={<Button size="lg" label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={submit} />}
    >
      <TextField label={tr('suppliers.fields.name')} placeholder={tr('suppliers.fields.name_placeholder')} value={name} onChangeText={setName} error={errs.name} required autoFocus={!editing} />
      <TextField label={tr('suppliers.fields.phone')} placeholder={tr('suppliers.fields.phone_placeholder')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={errs.phone} />
      <TextField label={tr('suppliers.fields.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={errs.email} />
      <TextField label={tr('suppliers.fields.tax_id')} placeholder={tr('suppliers.fields.tax_id_placeholder')} value={taxId} onChangeText={setTaxId} error={errs.tax_id} />
      <TextField label={tr('suppliers.fields.notes')} value={notes} onChangeText={setNotes} multiline error={errs.notes} />
      <SwitchRow label={tr('suppliers.fields.active')} value={active} onValueChange={setActive} />
    </Screen>
  );
}
