import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Header, ListSkeleton, MoneyField, Screen, Section, SelectField, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { serviceSwatch } from '@/features/catalog/lib/service-colors';
import { CustomerPicker, VehiclePicker } from '@/features/customers/components/pickers';
import type { Customer } from '@/features/customers/services/customers.service';
import { jobsService } from '@/features/jobs/services/jobs.service';
import { qk, useServices, useStaffOptions } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function NewJobScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.jobsWrite} title={tr('jobs.actions.create')}>
      <NewJobForm />
    </RequirePermission>
  );
}

type Line = { service_uuid: string; unit_price: string };

function NewJobForm() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const services = useServices({ is_active: 'true' });
  const staff = useStaffOptions();
  const serviceItems = useMemo(() => services.data?.items ?? [], [services.data]);
  const total = lines.reduce((s, l) => s + toNumber(l.unit_price), 0);

  const create = useApiMutation({
    key: 'jobs.create',
    fn: () =>
      jobsService.create({
        customer_uuid: customer!.uuid,
        vehicle_uuid: vehicle!,
        assignee_uuid: assignee || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => {
          const s = serviceItems.find((x) => x.uuid === l.service_uuid);
          return { service_uuid: l.service_uuid, unit_price: l.unit_price && l.unit_price !== s?.price ? l.unit_price : undefined };
        }),
      }),
    invalidate: [qk.jobs, qk.catalog, qk.reports],
    success: tr('jobs.toast.created'),
    onSuccess: (job) => router.replace(`/jobs/${job.uuid}`),
  });
  const apiErrors = fieldErrors(create.error);

  const toggle = (uuid: string, price: string) =>
    setLines((prev) => (prev.some((l) => l.service_uuid === uuid) ? prev.filter((l) => l.service_uuid !== uuid) : [...prev, { service_uuid: uuid, unit_price: price }]));

  const submit = () => {
    const next: Record<string, string> = {};
    if (!customer) next.customer = tr('jobs.validation.customer');
    if (!vehicle) next.vehicle = tr('jobs.validation.vehicle');
    if (!lines.length) next.lines = tr('jobs.validation.services');
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate(undefined);
  };

  return (
    <Screen
      header={<Header title={tr('jobs.actions.create')} subtitle={tr('jobs.create.description')} />}
      footer={
        <Button
          label={create.isPending ? tr('common.saving') : `${tr('common.save')} · ${fmt.money(total)}`}
          loading={create.isPending}
          onPress={submit}
          size="lg"
        />
      }
    >
      <CustomerPicker
        value={customer}
        onChange={(c) => {
          setCustomer(c);
          setVehicle(null);
        }}
        error={errors.customer ?? apiErrors.customer_uuid}
      />
      <VehiclePicker customerUuid={customer?.uuid ?? null} value={vehicle} onChange={setVehicle} error={errors.vehicle ?? apiErrors.vehicle_uuid} />

      <Section title={tr('jobs.services')}>
        {errors.lines ? (
          <Txt variant="caption" tone="danger">
            {errors.lines}
          </Txt>
        ) : null}
        {services.isLoading ? (
          <ListSkeleton rows={3} height={56} />
        ) : (
          <View style={{ gap: t.spacing.sm }}>
            {serviceItems.map((s) => {
              const line = lines.find((l) => l.service_uuid === s.uuid);
              const sw = serviceSwatch(s.color, s.name, t.scheme);
              return (
                <View
                  key={s.uuid}
                  style={{
                    borderRadius: t.radius.md,
                    borderWidth: 1.5,
                    borderColor: line ? t.colors.primary : t.colors.border,
                    backgroundColor: line ? t.colors.primarySoft : t.colors.surface,
                    overflow: 'hidden',
                  }}
                >
                  <Pressable
                    onPress={() => toggle(s.uuid, s.price)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: Boolean(line) }}
                    accessibilityLabel={s.name}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.md, minHeight: 52 }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: line ? t.colors.primary : t.colors.borderStrong,
                        backgroundColor: line ? t.colors.primary : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {line ? <Check size={14} color={t.colors.onPrimary} /> : null}
                    </View>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sw.solid }} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{s.name}</Txt>
                      <Txt variant="caption" tone="secondary">
                        {s.category_name ?? ''}
                        {s.duration_minutes ? ` · ${fmt.duration(s.duration_minutes)}` : ''}
                      </Txt>
                    </View>
                    <Txt variant="mono">{fmt.money(s.price, s.currency)}</Txt>
                  </Pressable>
                  {line ? (
                    <View style={{ paddingHorizontal: t.spacing.md, paddingBottom: t.spacing.md }}>
                      <MoneyField
                        label={tr('jobs.unit_price')}
                        value={line.unit_price}
                        onChangeText={(v) => setLines((prev) => prev.map((l) => (l.service_uuid === s.uuid ? { ...l, unit_price: v } : l)))}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </Section>

      <SelectField
        label={tr('jobs.assignee')}
        placeholder={tr('jobs.pick_assignee')}
        value={assignee}
        onChange={(v) => setAssignee(v ?? '')}
        options={[{ value: '', label: tr('jobs.assignee_none') }, ...(staff.data?.items ?? []).map((s) => ({ value: s.uuid, label: s.label, description: tr(`organizations.roles.${s.role}`) }))]}
      />
      <TextField label={tr('jobs.notes')} value={notes} onChangeText={setNotes} multiline />
    </Screen>
  );
}
