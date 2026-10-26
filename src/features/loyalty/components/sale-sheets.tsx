/** Sell a package, start a subscription, collect a period (web sell-package / start-subscription / pay-subscription dialogs). */
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, DateField, SelectField, Sheet, SwitchRow, TextField, Txt } from '@/components/ui';
import { CustomerPicker } from '@/features/customers/components/pickers';
import type { Customer } from '@/features/customers/services/customers.service';
import { useCustomer } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { dayDate, planUsesLabel } from '../lib/labels';
import { useActivePackages, useActivePlans, useLoyaltyMutations } from '../queries';
import type { Subscription } from '../types';
import { initialPayment, paymentBody, PaymentFields, useDefaultAccount, type PaymentState } from './payment-fields';

type FixedCustomer = { uuid: string; name: string };
type SellProps = { visible: boolean; onClose: () => void; customer?: FixedCustomer; onSold?: (uuid: string) => void };
type StartProps = { visible: boolean; onClose: () => void; customer?: FixedCustomer; onStarted?: (uuid: string) => void };
type PayProps = { visible: boolean; onClose: () => void; subscription: Subscription | null; next?: { start: string; end: string } };

/** Customer field: fixed (opened from the customer 360) or a picker. */
function CustomerField({ fixed, value, onChange, error }: { fixed?: FixedCustomer; value: Customer | null; onChange: (c: Customer | null) => void; error?: string }) {
  const { t: tr } = useLocale();
  if (fixed) return null;
  return <CustomerPicker label={tr('loyalty.fields.customer')} value={value} onChange={onChange} error={error} allowCreate={false} />;
}

function SellPackageForm({ onClose, customer, onSold }: Omit<SellProps, 'visible'>) {
  const { t: tr, fmt } = useLocale();
  const { sell } = useLoyaltyMutations();
  const packages = useActivePackages();
  const [picked, setPicked] = useState<Customer | null>(null);
  const [pkg, setPkg] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentState>(initialPayment);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { fallback } = useDefaultAccount(payment.method);
  const selected = packages.data?.items.find((p) => p.uuid === pkg);


  const submit = () => {
    const customerUuid = customer?.uuid ?? picked?.uuid;
    const body = paymentBody(payment, fallback);
    const e: Record<string, string> = {};
    if (!customerUuid) e.customer = tr('mobile.loyalty.required');
    if (!pkg) e.package = tr('mobile.loyalty.required');
    if (!body) e.account = tr('loyalty.validation.finance_account');
    setErrors(e);
    if (Object.keys(e).length || !body) return;
    sell.mutate(
      { package_uuid: pkg!, customer_uuid: customerUuid!, method: body.method, finance_account_uuid: body.finance_account_uuid, notes: notes.trim() },
      {
        onSuccess: (res) => {
          onClose();
          onSold?.(res.uuid);
        },
      },
    );
  };

  return (
    <>
      <Txt tone="secondary" variant="caption">
        {customer ? tr('loyalty.sell.description_for', { name: customer.name }) : tr('loyalty.sell.description')}
      </Txt>
      <CustomerField fixed={customer} value={picked} onChange={setPicked} error={errors.customer} />
      <SelectField
        label={tr('loyalty.fields.package')}
        placeholder={tr('loyalty.fields.pick_package')}
        value={pkg}
        onChange={setPkg}
        required
        loading={packages.isLoading}
        error={errors.package}
        options={(packages.data?.items ?? []).map((p) => ({
          value: p.uuid,
          label: p.name,
          description: [fmt.money(p.price, p.currency), p.items.map((i) => `${i.quantity}× ${i.service_name}`).join(', ')].join(' · '),
        }))}
      />
      {selected ? (
        <Card style={{ gap: 4 }}>
          <Txt variant="bodyStrong">{fmt.money(selected.price, selected.currency)}</Txt>
          <Txt variant="caption" tone="secondary">
            {selected.items.map((i) => `${i.quantity}× ${i.service_name}`).join(', ')}
          </Txt>
          <Txt variant="caption" tone="muted">
            {selected.validity_days ? tr('loyalty.packages.valid_days', { count: selected.validity_days }) : tr('loyalty.packages.no_expiry')}
          </Txt>
        </Card>
      ) : null}
      <PaymentFields value={payment} onChange={setPayment} error={errors.account} />
      <TextField label={tr('loyalty.fields.notes')} value={notes} onChangeText={setNotes} multiline />
      <Button label={tr('loyalty.sell.submit')} onPress={submit} loading={sell.isPending} size="lg" />
    </>
  );
}

function StartSubscriptionForm({ onClose, customer, onStarted }: Omit<StartProps, 'visible'>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { start } = useLoyaltyMutations();
  const plans = useActivePlans();
  const [picked, setPicked] = useState<Customer | null>(null);
  const customerUuid = customer?.uuid ?? picked?.uuid ?? null;
  const detail = useCustomer(customerUuid);
  const [plan, setPlan] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [collect, setCollect] = useState(true);
  const [payment, setPayment] = useState<PaymentState>(initialPayment);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { fallback } = useDefaultAccount(payment.method);
  const selected = plans.data?.items.find((p) => p.uuid === plan);
  const vehicles = useMemo(() => detail.data?.vehicles ?? [], [detail.data]);


  const submit = () => {
    const body = collect ? paymentBody(payment, fallback) : null;
    const e: Record<string, string> = {};
    if (!customerUuid) e.customer = tr('mobile.loyalty.required');
    if (!plan) e.plan = tr('mobile.loyalty.required');
    if (collect && !body) e.account = tr('loyalty.validation.finance_account');
    setErrors(e);
    if (Object.keys(e).length) return;
    start.mutate(
      { plan_uuid: plan!, customer_uuid: customerUuid!, vehicle_uuid: vehicle, start_date: startDate, notes: notes.trim(), payment: body },
      {
        onSuccess: (res) => {
          onClose();
          onStarted?.(res.uuid);
        },
      },
    );
  };

  return (
    <>
      <Txt tone="secondary" variant="caption">
        {customer ? tr('loyalty.start.description_for', { name: customer.name }) : tr('loyalty.start.description')}
      </Txt>
      <CustomerField
        fixed={customer}
        value={picked}
        onChange={(c) => {
          setPicked(c);
          setVehicle(null);
        }}
        error={errors.customer}
      />
      <SelectField
        label={tr('loyalty.fields.plan')}
        placeholder={tr('loyalty.fields.pick_plan')}
        value={plan}
        onChange={setPlan}
        required
        loading={plans.isLoading}
        error={errors.plan}
        options={(plans.data?.items ?? []).map((p) => ({ value: p.uuid, label: p.name, description: `${fmt.money(p.price, p.currency)} · ${planUsesLabel(tr, p)}` }))}
      />
      {selected ? (
        <Txt variant="caption" tone="muted">
          {[fmt.money(selected.price, selected.currency), planUsesLabel(tr, selected)].join(' · ')}
        </Txt>
      ) : null}
      {customerUuid && vehicles.length ? (
        <SelectField
          label={tr('loyalty.fields.vehicle')}
          value={vehicle ?? ''}
          onChange={(v) => setVehicle(v || null)}
          options={[{ value: '', label: tr('loyalty.fields.any_vehicle') }, ...vehicles.map((v) => ({ value: v.uuid, label: v.plate, description: `${v.brand_name} ${v.model_name}` }))]}
        />
      ) : null}
      <DateField label={tr('loyalty.fields.start_date')} value={startDate} onChange={setStartDate} allowClear />
      <View style={{ gap: t.spacing.sm }}>
        <SwitchRow label={tr('loyalty.fields.collect_now')} description={tr('loyalty.fields.collect_now_hint')} value={collect} onValueChange={setCollect} />
        {collect ? <PaymentFields value={payment} onChange={setPayment} error={errors.account} /> : null}
      </View>
      <TextField label={tr('loyalty.fields.notes')} value={notes} onChangeText={setNotes} multiline />
      <Button label={tr('loyalty.start.submit')} onPress={submit} loading={start.isPending} size="lg" />
    </>
  );
}

/** Collects the next unpaid period (`next_period`) of a subscription. */
function PaySubscriptionForm({ onClose, subscription, next }: Omit<PayProps, 'visible'>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { pay } = useLoyaltyMutations();
  const [payment, setPayment] = useState<PaymentState>(initialPayment);
  const [error, setError] = useState<string | null>(null);
  const { fallback } = useDefaultAccount(payment.method);


  const submit = () => {
    const body = paymentBody(payment, fallback);
    if (!body || !subscription) {
      setError(tr('loyalty.validation.finance_account'));
      return;
    }
    pay.mutate({ uuid: subscription.uuid, body }, { onSuccess: onClose });
  };

  return (
    <>
      {subscription ? (
        <View style={{ alignItems: 'center', gap: 4, paddingVertical: t.spacing.md }}>
          <Txt variant="caption" tone="secondary">
            {subscription.name} · {subscription.customer_name}
          </Txt>
          <Txt variant="display" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt.money(subscription.price, subscription.currency)}
          </Txt>
        </View>
      ) : null}
      {next ? (
        <Txt tone="secondary" variant="caption">
          {tr('loyalty.pay.description', { from: fmt.date(dayDate(next.start)), to: fmt.date(dayDate(next.end)) })}
        </Txt>
      ) : null}
      <PaymentFields value={payment} onChange={setPayment} error={error} />
      <Button label={tr('loyalty.pay.submit')} onPress={submit} loading={pay.isPending} size="lg" />
    </>
  );
}

// ─── Sheets (the form remounts on every open) ──────────────────────────────

const formKey = (visible: boolean) => (visible ? 'open' : 'closed');

export function SellPackageSheet(props: SellProps) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={tr('loyalty.sell.title')}>
      <SellPackageForm key={formKey(props.visible)} {...props} />
    </Sheet>
  );
}

export function StartSubscriptionSheet(props: StartProps) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={tr('loyalty.start.title')}>
      <StartSubscriptionForm key={formKey(props.visible)} {...props} />
    </Sheet>
  );
}

export function PaySubscriptionSheet(props: PayProps) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={tr('loyalty.pay.title')}>
      <PaySubscriptionForm key={formKey(props.visible)} {...props} />
    </Sheet>
  );
}
