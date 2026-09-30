/** Create / edit a lead — web `LeadDialog` (`features/leads/components/lead-dialog.tsx`). `?id=` edits, `?customer=` prefills. */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button, DateField, Field, Header, ListSkeleton, Screen, SelectField, TextField } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { CustomerPicker } from '@/features/customers/components/pickers';
import type { Customer } from '@/features/customers/services/customers.service';
import { Chip, ChipRow } from '@/features/leads/components/crm-ui';
import { TemperatureToggle } from '@/features/leads/components/temperature-toggle';
import { pickedCustomer } from '@/features/leads/lib/lead-ui';
import { useLeadMutations } from '@/features/leads/queries';
import { LEAD_SOURCES, type LeadDetail, type LeadSource, type LeadTemperature } from '@/features/leads/types';
import { useCustomer, useLead, useLeadAssignees } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';

const NONE = '__none__';

export default function LeadFormScreen() {
  const { t: tr } = useLocale();
  const { id, customer } = useLocalSearchParams<{ id?: string; customer?: string }>();
  const existing = useLead(id ?? '');
  const prefill = useCustomer(!id && customer ? customer : null);
  const loading = (id && existing.isLoading) || (!id && customer && prefill.isLoading);
  return (
    <RequirePermission gate={P.leadsWrite} title={tr('leads.dialog.create_title')}>
      {loading ? (
        <Screen header={<Header title={id ? tr('leads.dialog.edit_title') : tr('leads.dialog.create_title')} />}>
          <ListSkeleton rows={6} height={56} />
        </Screen>
      ) : (
        <LeadForm
          key={existing.data?.uuid ?? prefill.data?.uuid ?? 'new'}
          lead={id ? (existing.data ?? null) : null}
          initialCustomer={prefill.data ?? null}
        />
      )}
    </RequirePermission>
  );
}

function LeadForm({ lead, initialCustomer }: { lead: LeadDetail | null; initialCustomer: Customer | null }) {
  const { t: tr } = useLocale();
  const { create, patch } = useLeadMutations();
  const assignees = useLeadAssignees();
  const [customer, setCustomer] = useState<Customer | null>(lead ? pickedCustomer(lead.customer_uuid, lead.customer_name, lead.customer_phone) : initialCustomer);
  const [interest, setInterest] = useState(lead?.interest ?? '');
  const [vehicleUuid, setVehicleUuid] = useState(lead?.vehicle_uuid ?? '');
  const [vehicleText, setVehicleText] = useState(lead?.vehicle_text ?? '');
  const [source, setSource] = useState<LeadSource>(lead?.source ?? 'incoming_call');
  const [temperature, setTemperature] = useState<LeadTemperature>(lead?.temperature ?? 'warm');
  const [followUp, setFollowUp] = useState(lead?.follow_up_date ?? '');
  const [assignee, setAssignee] = useState(lead?.assignee?.uuid ?? '');
  const [notes, setNotes] = useState(lead?.notes ?? '');
  const [customerError, setCustomerError] = useState(false);
  const customerDetail = useCustomer(customer?.uuid);
  const vehicles = customerDetail.data?.vehicles ?? [];
  const pending = create.isPending || patch.isPending;
  const errs = fieldErrors(lead ? patch.error : create.error);

  const submit = () => {
    if (!customer) {
      setCustomerError(true);
      return;
    }
    if (lead) {
      patch.mutate(
        {
          uuid: lead.uuid,
          body: {
            customer_uuid: customer.uuid,
            interest,
            vehicle_uuid: vehicleUuid,
            vehicle_text: vehicleText,
            source,
            temperature,
            follow_up_date: followUp,
            assignee_uuid: assignee,
            notes,
          },
        },
        { onSuccess: () => router.back() },
      );
    } else {
      create.mutate(
        {
          customer_uuid: customer.uuid,
          interest: interest.trim(),
          vehicle_uuid: vehicleUuid || null,
          vehicle_text: vehicleText.trim(),
          source,
          temperature,
          follow_up_date: followUp || null,
          assignee_uuid: assignee || null,
          notes: notes.trim(),
        },
        { onSuccess: (saved) => router.replace(`/leads/${saved.uuid}`) },
      );
    }
  };

  return (
    <Screen
      header={<Header title={lead ? tr('leads.dialog.edit_title') : tr('leads.dialog.create_title')} subtitle={tr('leads.dialog.description')} />}
      footer={<Button size="lg" label={pending ? tr('common.saving') : tr('common.save')} loading={pending} onPress={submit} />}
    >
      <Field label={tr('leads.fields.source')}>
        <ChipRow>
          {LEAD_SOURCES.map((src) => (
            <Chip key={src} label={tr(`leads.source.${src}`)} active={source === src} onPress={() => setSource(src)} />
          ))}
        </ChipRow>
      </Field>
      <CustomerPicker
        label={tr('leads.fields.customer')}
        value={customer}
        onChange={(c) => {
          setCustomerError(false);
          setCustomer(c);
          setVehicleUuid('');
        }}
        error={customerError ? tr('leads.validation.customer') : errs.customer_uuid}
      />
      <TextField label={tr('leads.fields.interest')} placeholder={tr('leads.placeholders.interest')} value={interest} onChangeText={setInterest} maxLength={300} error={errs.interest} />
      {vehicles.length > 0 ? (
        <SelectField
          label={tr('leads.fields.vehicle')}
          value={vehicleUuid || NONE}
          onChange={(v) => setVehicleUuid(!v || v === NONE ? '' : v)}
          options={[{ value: NONE, label: tr('leads.placeholders.no_vehicle') }, ...vehicles.map((v) => ({ value: v.uuid, label: `${v.plate} · ${v.brand_name} ${v.model_name}` }))]}
        />
      ) : (
        <TextField label={tr('leads.fields.vehicle')} placeholder={tr('leads.placeholders.vehicle_text')} value={vehicleText} onChangeText={setVehicleText} maxLength={200} error={errs.vehicle_text} />
      )}
      <Field label={tr('leads.fields.temperature')}>
        <TemperatureToggle value={temperature} onChange={setTemperature} />
      </Field>
      <DateField label={tr('leads.fields.follow_up_date')} value={followUp || null} onChange={(v) => setFollowUp(v ?? '')} allowClear error={errs.follow_up_date} />
      <SelectField
        label={tr('leads.fields.assignee')}
        value={assignee || NONE}
        onChange={(v) => setAssignee(!v || v === NONE ? '' : v)}
        loading={assignees.isLoading}
        options={[{ value: NONE, label: tr('leads.unassigned') }, ...(assignees.data ?? []).map((a) => ({ value: a.uuid, label: a.label }))]}
      />
      <TextField label={tr('leads.fields.notes')} value={notes} onChangeText={setNotes} multiline error={errs.notes} />
    </Screen>
  );
}
