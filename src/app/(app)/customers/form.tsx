import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorState, Header, ListSkeleton, Screen, Section, Segmented, SwitchRow, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { VehicleModelPicker } from '@/features/customers/components/pickers';
import { customersService, type CustomerDetail } from '@/features/customers/services/customers.service';
import { qk, useCustomer } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function CustomerFormScreen() {
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useCustomer(id);
  return (
    <RequirePermission gate={P.customersWrite} title={tr('customers.dialog.create_title')}>
      {id && existing.isLoading ? (
        <Screen header={<Header title={tr('customers.dialog.edit_title')} />}>
          <ListSkeleton rows={5} height={56} />
        </Screen>
      ) : id && (existing.isError || !existing.data) ? (
        <Screen header={<Header title={tr('customers.dialog.edit_title')} />}>
          <ErrorState error={existing.error} description={tr('customers.error_description')} onRetry={() => existing.refetch()} />
        </Screen>
      ) : (
        <CustomerForm key={existing.data?.uuid ?? 'new'} customer={existing.data ?? null} />
      )}
    </RequirePermission>
  );
}

function CustomerForm({ customer }: { customer: CustomerDetail | null }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const editing = Boolean(customer);
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [kind, setKind] = useState<'individual' | 'company'>(customer?.kind ?? 'individual');
  const [taxId, setTaxId] = useState(customer?.tax_id ?? '');
  const [taxOffice, setTaxOffice] = useState(customer?.tax_office ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [active, setActive] = useState(customer?.is_active ?? true);
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useApiMutation({
    key: editing ? 'customers.update' : 'customers.create',
    fn: () => {
      const body = { name: name.trim(), phone: phone.trim(), email: email.trim(), kind, tax_id: taxId.trim(), tax_office: taxOffice.trim(), notes, is_active: active };
      if (editing) return customersService.update(customer!.uuid, body);
      const [modelUuid, year] = (model ?? '').split(':');
      return customersService.create({ ...body, ...(plate.trim() && model ? { vehicle: { plate: plate.trim(), model_uuid: modelUuid, year: Number(year) } } : {}) });
    },
    invalidate: [qk.customers, qk.cari],
    success: editing ? tr('customers.toast.updated') : tr('customers.toast.created'),
    onSuccess: (c) => (editing ? router.back() : router.replace(`/customers/${c.uuid}`)),
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('form.required');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = tr('auth.validation.email');
    if (!editing && (plate.trim() || model) && !(plate.trim() && model)) e['vehicle.plate'] = tr('jobs.quick.vehicle_required');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(undefined);
  };

  return (
    <Screen
      header={<Header title={editing ? tr('customers.dialog.edit_title') : tr('customers.dialog.create_title')} subtitle={editing ? customer!.name : tr('customers.dialog.description')} />}
      footer={<Button label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={submit} size="lg" />}
    >
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('customers.fields.kind')}
        </Txt>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'individual', label: tr('customers.kind.individual') },
            { value: 'company', label: tr('customers.kind.company') },
          ]}
        />
      </View>
      <TextField label={tr('customers.fields.name')} placeholder={tr('customers.fields.name_placeholder')} value={name} onChangeText={setName} error={errs.name} required autoFocus={!editing} />
      <TextField label={tr('customers.fields.phone')} placeholder={tr('customers.fields.phone_placeholder')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={errs.phone} />
      <TextField label={tr('customers.fields.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={errs.email} />
      {kind === 'company' ? (
        <>
          <TextField label={tr('customers.fields.tax_id')} placeholder={tr('customers.fields.tax_id_placeholder')} value={taxId} onChangeText={setTaxId} keyboardType="number-pad" error={errs.tax_id} />
          <TextField label={tr('customers.fields.tax_office')} placeholder={tr('customers.fields.tax_office_placeholder')} value={taxOffice} onChangeText={setTaxOffice} error={errs.tax_office} />
        </>
      ) : null}
      <TextField label={tr('customers.fields.notes')} value={notes} onChangeText={setNotes} multiline />
      <SwitchRow label={tr('customers.fields.active')} value={active} onValueChange={setActive} />

      {!editing ? (
        <Section title={tr('customers.dialog.vehicle_section')}>
          <Card style={{ gap: t.spacing.md }}>
            <Txt variant="caption" tone="secondary">
              {tr('customers.dialog.vehicle_section_hint')}
            </Txt>
            <TextField
              label={tr('customers.detail.plate')}
              placeholder={tr('customers.detail.plate_placeholder')}
              value={plate}
              onChangeText={(v) => setPlate(v.toLocaleUpperCase('tr-TR'))}
              autoCapitalize="characters"
              error={errs['vehicle.plate']}
            />
            <VehicleModelPicker value={model} onChange={(v) => setModel(v)} error={errs['vehicle.model_uuid']} />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
