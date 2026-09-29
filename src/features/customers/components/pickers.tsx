import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, PlateBadge, Row, SelectField, Sheet, TextField, Txt } from '@/components/ui';
import { customersService, type Customer, type CustomerDetail, type CustomerVehicle } from '@/features/customers/services/customers.service';
import { qk, useCustomer, useCustomersSearch, useVehicleCatalog } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

/** Searchable customer picker with inline "quick customer" create (web create-job dialog). */
export function CustomerPicker({
  value,
  onChange,
  error,
  label,
  allowCreate = true,
}: {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  error?: string | null;
  label?: string;
  allowCreate?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [q, setQ] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const search = useCustomersSearch(q);
  const options = useMemo(() => {
    const items = search.data?.items ?? [];
    const merged = value && !items.some((c) => c.uuid === value.uuid) ? [value, ...items] : items;
    return merged.map((c) => ({ value: c.uuid, label: c.name, description: [c.phone, c.kind === 'company' ? tr('customers.kind.company') : null].filter(Boolean).join(' · ') }));
  }, [search.data, value, tr]);
  const byId = useMemo(() => new Map([...(search.data?.items ?? []), ...(value ? [value] : [])].map((c) => [c.uuid, c])), [search.data, value]);

  return (
    <View style={{ gap: 6 }}>
      <SelectField
        label={label ?? tr('jobs.customer')}
        placeholder={tr('jobs.pick_customer')}
        value={value?.uuid ?? null}
        onChange={(v) => onChange(v ? (byId.get(v) ?? null) : null)}
        options={options}
        onSearch={setQ}
        loading={search.isFetching}
        error={error}
        required
        footer={
          allowCreate
            ? (close) => (
                <Button
                  variant="secondary"
                  label={tr('jobs.quick.add_customer')}
                  icon={<Plus size={18} color={t.colors.primary} />}
                  onPress={() => {
                    close();
                    setQuickOpen(true);
                  }}
                />
              )
            : undefined
        }
      />
      {allowCreate ? (
        <QuickCustomerSheet
          visible={quickOpen}
          onClose={() => setQuickOpen(false)}
          onCreated={(c) => {
            onChange(c);
            setQuickOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function QuickCustomerSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (c: CustomerDetail) => void }) {
  const { t: tr } = useLocale();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation({
    key: 'customers.create.quick',
    fn: () => customersService.create({ name: name.trim(), phone: phone.trim() }),
    invalidate: [qk.customers],
    success: tr('customers.toast.created'),
    onSuccess: (c) => {
      setName('');
      setPhone('');
      onCreated(c);
    },
  });
  const errs = fieldErrors(create.error);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('jobs.quick.add_customer')}
      footer={
        <Button
          label={create.isPending ? tr('common.saving') : tr('jobs.quick.save_customer')}
          loading={create.isPending}
          size="lg"
          onPress={() => {
            if (!name.trim()) {
              setError(tr('jobs.quick.customer_name_required'));
              return;
            }
            setError(null);
            create.mutate(undefined);
          }}
        />
      }
    >
      <TextField label={tr('customers.fields.name')} placeholder={tr('jobs.quick.name_placeholder')} value={name} onChangeText={setName} error={error ?? errs.name} autoFocus required />
      <TextField label={tr('customers.fields.phone')} placeholder={tr('jobs.quick.phone_placeholder')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={errs.phone} />
    </Sheet>
  );
}

/** Vehicle catalog search (brand · model · year) used by vehicle forms. */
export function VehicleModelPicker({ value, onChange, error, label }: { value: string | null; onChange: (v: string | null, label?: string) => void; error?: string | null; label?: string }) {
  const { t: tr } = useLocale();
  const [q, setQ] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const catalog = useVehicleCatalog(q);
  const options = useMemo(() => {
    const items = (catalog.data?.items ?? []).map((i) => ({ value: `${i.model_uuid}:${i.year}`, label: `${i.brand_name} ${i.model_name} · ${i.year}`, description: i.brand_name }));
    if (value && selectedLabel && !items.some((o) => o.value === value)) items.unshift({ value, label: selectedLabel, description: '' });
    return items;
  }, [catalog.data, value, selectedLabel]);
  return (
    <SelectField
      label={label ?? tr('customers.detail.catalog')}
      placeholder={tr('jobs.quick.catalog_placeholder')}
      value={value}
      onChange={(v, opt) => {
        setSelectedLabel(opt?.label ?? null);
        onChange(v, opt?.label);
      }}
      options={options}
      onSearch={setQ}
      loading={catalog.isFetching}
      error={error}
      required
    />
  );
}

/** Customer's vehicles + inline "add vehicle" (plate + catalog model). */
export function VehiclePicker({
  customerUuid,
  value,
  onChange,
  error,
}: {
  customerUuid: string | null;
  value: string | null;
  onChange: (v: string | null) => void;
  error?: string | null;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const customer = useCustomer(customerUuid);
  const [addOpen, setAddOpen] = useState(false);
  const vehicles = customer.data?.vehicles ?? [];
  return (
    <View style={{ gap: 6 }}>
      <SelectField
        label={tr('jobs.vehicle')}
        placeholder={customerUuid ? tr('jobs.pick_vehicle') : tr('jobs.validation.customer')}
        value={value}
        onChange={onChange}
        disabled={!customerUuid}
        loading={customer.isLoading}
        error={error}
        required
        options={vehicles.map((v) => ({ value: v.uuid, label: `${v.plate} · ${v.brand_name} ${v.model_name}`, description: String(v.year), left: <PlateBadge plate={v.plate} size="sm" /> }))}
        footer={(close) => (
          <Button
            variant="secondary"
            label={tr('jobs.quick.add_vehicle')}
            icon={<Plus size={18} color={t.colors.primary} />}
            onPress={() => {
              close();
              setAddOpen(true);
            }}
          />
        )}
      />
      {customerUuid ? (
        <Row>
          <Button
            size="sm"
            variant="ghost"
            label={tr('jobs.quick.add_vehicle')}
            icon={<Plus size={16} color={t.colors.primary} />}
            onPress={() => setAddOpen(true)}
          />
        </Row>
      ) : null}
      {customerUuid ? (
        <AddVehicleSheet
          customerUuid={customerUuid}
          visible={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={(v) => {
            onChange(v.uuid);
            setAddOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

export function AddVehicleSheet({
  customerUuid,
  visible,
  onClose,
  onCreated,
}: {
  customerUuid: string;
  visible: boolean;
  onClose: () => void;
  onCreated?: (v: CustomerVehicle) => void;
}) {
  const { t: tr } = useLocale();
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = useApiMutation({
    key: 'customers.vehicle.add',
    fn: () => {
      const [modelUuid, year] = (model ?? '').split(':');
      return customersService.addVehicle(customerUuid, { plate: plate.trim().toLocaleUpperCase('tr-TR'), model_uuid: modelUuid, year: Number(year) });
    },
    invalidate: [qk.customers],
    success: tr('customers.toast.vehicle'),
    onSuccess: (v) => {
      setPlate('');
      setModel(null);
      onCreated?.(v);
    },
  });
  const errs = fieldErrors(add.error);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('jobs.quick.add_vehicle')}
      footer={
        <Button
          size="lg"
          label={add.isPending ? tr('common.saving') : tr('jobs.quick.save_vehicle')}
          loading={add.isPending}
          onPress={() => {
            if (!plate.trim() || !model) {
              setError(tr('jobs.quick.vehicle_required'));
              return;
            }
            setError(null);
            add.mutate(undefined);
          }}
        />
      }
    >
      <TextField
        label={tr('customers.detail.plate')}
        placeholder={tr('jobs.quick.plate_placeholder')}
        value={plate}
        onChangeText={(v) => setPlate(v.toLocaleUpperCase('tr-TR'))}
        autoCapitalize="characters"
        autoCorrect={false}
        error={errs['vehicle.plate'] ?? errs.plate}
        required
      />
      <VehicleModelPicker value={model} onChange={(v) => setModel(v)} error={errs['vehicle.model_uuid']} />
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}
    </Sheet>
  );
}
