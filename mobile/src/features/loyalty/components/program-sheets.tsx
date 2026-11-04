/** Create / edit sheets for campaigns, package definitions and subscription plans (web campaign / package / plan dialogs). */
import { Minus, Plus, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, DateField, Field, IconButton, MoneyField, Row, SelectField, Segmented, Sheet, SwitchRow, TextField, Txt, useConfirm } from '@/components/ui';
import { useServices } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { useLoyaltyMutations } from '../queries';
import type { LoyaltyCampaign, LoyaltyPackage, LoyaltyPlan, RewardType } from '../types';
import { EligibilityPicker } from './eligibility-picker';

const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s.trim()));
const digits = (s: string) => s.replace(/[^0-9]/g, '');

function SheetFooter({ onSave, saving, onDelete, deleteLabel }: { onSave: () => void; saving: boolean; onDelete?: () => void; deleteLabel?: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Button label={tr('common.save')} onPress={onSave} loading={saving} size="lg" />
      {onDelete ? <Button label={deleteLabel ?? tr('common.delete')} variant="ghost" onPress={onDelete} icon={<Trash2 size={16} color={t.colors.primary} />} /> : null}
    </View>
  );
}

// ─── Campaign ──────────────────────────────────────────────────────────────

function CampaignForm({ onClose, campaign }: { onClose: () => void; campaign: LoyaltyCampaign | null }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const confirm = useConfirm();
  const { saveCampaign, deleteCampaign } = useLoyaltyMutations();
  const services = useServices({ is_active: 'true' });
  const [name, setName] = useState(campaign?.name ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [svc, setSvc] = useState<string[]>(campaign?.services.map((s) => s.uuid) ?? []);
  const [cats, setCats] = useState<string[]>(campaign?.categories.map((c) => c.uuid) ?? []);
  const [stamps, setStamps] = useState(String(campaign?.stamps_required ?? 10));
  const [rewardType, setRewardType] = useState<RewardType>(campaign?.reward_type ?? 'free_service');
  const [rewardService, setRewardService] = useState<string | null>(campaign?.reward_service?.uuid ?? null);
  const [rewardValue, setRewardValue] = useState(campaign && campaign.reward_type !== 'free_service' ? String(Number(campaign.reward_value)) : '');
  const [from, setFrom] = useState<string | null>(campaign?.valid_from ?? null);
  const [until, setUntil] = useState<string | null>(campaign?.valid_until ?? null);
  const [limit, setLimit] = useState(campaign?.per_customer_limit ? String(campaign.per_customer_limit) : '');
  const [active, setActive] = useState(campaign?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});


  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('mobile.loyalty.required');
    const n = Number(stamps);
    if (!Number.isInteger(n) || n < 1 || n > 100) e.stamps = tr('loyalty.fields.stamps_required_hint');
    if (!svc.length && !cats.length) e.eligibility = tr('loyalty.validation.eligibility');
    if (rewardType === 'free_service' && !rewardService) e.reward = tr('mobile.loyalty.required');
    if (rewardType !== 'free_service' && (!(Number(rewardValue) > 0) || (rewardType === 'percent' && Number(rewardValue) > 100))) e.reward = tr('loyalty.validation.reward_value');
    if (from && until && until < from) e.window = tr('loyalty.validation.window');
    setErrors(e);
    if (Object.keys(e).length) return;
    saveCampaign.mutate(
      {
        uuid: campaign?.uuid,
        body: {
          name: name.trim(),
          description: description.trim(),
          service_uuids: svc,
          category_uuids: cats,
          stamps_required: n,
          reward_type: rewardType,
          reward_service_uuid: rewardType === 'free_service' ? rewardService : null,
          reward_value: rewardType === 'free_service' ? undefined : rewardValue,
          valid_from: from,
          valid_until: until,
          is_active: active,
          per_customer_limit: intOrNull(limit),
        },
      },
      { onSuccess: onClose },
    );
  };

  const remove = async () => {
    if (!campaign) return;
    if (await confirm({ title: tr('loyalty.campaigns.delete'), message: tr('loyalty.campaigns.delete_confirm'), destructive: true, confirmLabel: tr('loyalty.campaigns.delete') }))
      deleteCampaign.mutate(campaign.uuid, { onSuccess: onClose });
  };

  return (
    <>
      <Txt tone="secondary" variant="caption">
        {tr('loyalty.campaigns.form_hint')}
      </Txt>
      <TextField label={tr('loyalty.fields.name')} value={name} onChangeText={setName} placeholder={tr('loyalty.campaigns.name_placeholder')} error={errors.name} required />
      <TextField label={tr('loyalty.fields.description')} value={description} onChangeText={setDescription} multiline />
      <EligibilityPicker services={svc} categories={cats} onServices={setSvc} onCategories={setCats} error={errors.eligibility} />
      <TextField
        label={tr('loyalty.fields.stamps_required')}
        hint={tr('loyalty.fields.stamps_required_hint')}
        value={stamps}
        onChangeText={(v) => setStamps(digits(v))}
        keyboardType="number-pad"
        error={errors.stamps}
        required
      />
      <Field label={tr('loyalty.fields.reward_type')} error={rewardType === 'free_service' ? undefined : errors.reward}>
        <Segmented<RewardType> value={rewardType} onChange={setRewardType} options={(['free_service', 'percent', 'fixed'] as const).map((r) => ({ value: r, label: tr(`loyalty.reward_type.${r}`) }))} />
      </Field>
      {rewardType === 'free_service' ? (
        <SelectField
          label={tr('loyalty.fields.reward_service')}
          placeholder={tr('loyalty.fields.pick_service')}
          value={rewardService}
          onChange={setRewardService}
          searchable
          required
          error={errors.reward}
          options={(services.data?.items ?? []).map((s) => ({ value: s.uuid, label: s.name }))}
        />
      ) : rewardType === 'percent' ? (
        <TextField label={tr('loyalty.fields.reward_percent')} value={rewardValue} onChangeText={(v) => setRewardValue(digits(v).slice(0, 3))} keyboardType="number-pad" right={<Txt tone="muted">%</Txt>} />
      ) : (
        <MoneyField label={tr('loyalty.fields.reward_amount')} value={rewardValue} onChangeText={setRewardValue} />
      )}
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('loyalty.fields.valid_from')} value={from} onChange={setFrom} allowClear />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label={tr('loyalty.fields.valid_until')} value={until} onChange={setUntil} allowClear error={errors.window} />
        </View>
      </Row>
      <TextField
        label={tr('loyalty.fields.per_customer_limit')}
        value={limit}
        onChangeText={(v) => setLimit(digits(v).slice(0, 4))}
        keyboardType="number-pad"
        placeholder={tr('loyalty.fields.unlimited')}
      />
      <SwitchRow label={tr('loyalty.fields.is_active')} value={active} onValueChange={setActive} />
      <SheetFooter onSave={submit} saving={saveCampaign.isPending} onDelete={campaign ? remove : undefined} deleteLabel={tr('loyalty.campaigns.delete')} />
    </>
  );
}

// ─── Package definition ────────────────────────────────────────────────────

type Item = { service_uuid: string; quantity: number };

function PackageForm({ onClose, pkg }: { onClose: () => void; pkg: LoyaltyPackage | null }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const { savePackage, deletePackage } = useLoyaltyMutations();
  const services = useServices({ is_active: 'true' });
  const byId = useMemo(() => new Map((services.data?.items ?? []).map((s) => [s.uuid, s])), [services.data]);
  const [name, setName] = useState(pkg?.name ?? '');
  const [description, setDescription] = useState(pkg?.description ?? '');
  const [price, setPrice] = useState(pkg ? String(Number(pkg.price)) : '');
  const [validity, setValidity] = useState(pkg?.validity_days ? String(pkg.validity_days) : '');
  const [items, setItems] = useState<Item[]>(pkg?.items.map((i) => ({ service_uuid: i.service_uuid, quantity: i.quantity })) ?? []);
  const [active, setActive] = useState(pkg?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});


  const listValue = items.reduce((s, it) => s + it.quantity * Number(byId.get(it.service_uuid)?.price ?? pkg?.items.find((x) => x.service_uuid === it.service_uuid)?.unit_price ?? 0), 0);
  const nameOf = (id: string) => byId.get(id)?.name ?? pkg?.items.find((x) => x.service_uuid === id)?.service_name ?? '—';
  const setQty = (id: string, q: number) => setItems((list) => list.map((it) => (it.service_uuid === id ? { ...it, quantity: Math.min(Math.max(q, 1), 1000) } : it)));

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('mobile.loyalty.required');
    if (!(Number(price) > 0)) e.price = tr('loyalty.validation.price');
    if (!items.length) e.items = tr('loyalty.validation.items');
    setErrors(e);
    if (Object.keys(e).length) return;
    savePackage.mutate(
      {
        uuid: pkg?.uuid,
        body: { name: name.trim(), description: description.trim(), price, validity_days: intOrNull(validity), is_active: active, items },
      },
      { onSuccess: onClose },
    );
  };

  const remove = async () => {
    if (!pkg) return;
    if (await confirm({ title: tr('loyalty.packages.delete'), message: tr('loyalty.packages.delete_confirm'), destructive: true, confirmLabel: tr('loyalty.packages.delete') }))
      deletePackage.mutate(pkg.uuid, { onSuccess: onClose });
  };

  return (
    <>
      <Txt tone="secondary" variant="caption">
        {tr('loyalty.packages.form_hint')}
      </Txt>
      <TextField label={tr('loyalty.fields.name')} value={name} onChangeText={setName} placeholder={tr('loyalty.packages.name_placeholder')} error={errors.name} required />
      <TextField label={tr('loyalty.fields.description')} value={description} onChangeText={setDescription} multiline />
      <Field label={tr('loyalty.fields.items')} hint={tr('loyalty.fields.items_hint')} error={errors.items} required>
        <View style={{ gap: t.spacing.sm }}>
          {items.map((it) => (
            <Row key={it.service_uuid} gap={t.spacing.sm} style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: t.spacing.sm }}>
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {nameOf(it.service_uuid)}
              </Txt>
              <IconButton variant="ghost" label={`${tr('loyalty.fields.quantity')} −`} icon={<Minus size={16} color={t.colors.text} />} onPress={() => setQty(it.service_uuid, it.quantity - 1)} />
              <Txt variant="bodyStrong" style={{ minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }} accessibilityLabel={`${tr('loyalty.fields.quantity')}: ${it.quantity}`}>
                {it.quantity}
              </Txt>
              <IconButton variant="ghost" label={`${tr('loyalty.fields.quantity')} +`} icon={<Plus size={16} color={t.colors.text} />} onPress={() => setQty(it.service_uuid, it.quantity + 1)} />
              <IconButton
                variant="ghost"
                label={`${tr('loyalty.actions.remove')}: ${nameOf(it.service_uuid)}`}
                icon={<Trash2 size={16} color={t.colors.danger} />}
                onPress={() => setItems((list) => list.filter((x) => x.service_uuid !== it.service_uuid))}
              />
            </Row>
          ))}
          <SelectField
            value={null}
            placeholder={tr('loyalty.fields.add_service')}
            searchable
            options={(services.data?.items ?? []).filter((s) => !items.some((it) => it.service_uuid === s.uuid)).map((s) => ({ value: s.uuid, label: s.name, description: fmt.money(s.price, s.currency) }))}
            onChange={(v) => v && setItems((list) => [...list, { service_uuid: v, quantity: 1 }])}
          />
          {items.length ? (
            <Txt variant="caption" tone="muted">
              {tr('loyalty.packages.list_value', { value: fmt.money(listValue) })}
            </Txt>
          ) : null}
        </View>
      </Field>
      <MoneyField label={tr('loyalty.fields.price')} value={price} onChangeText={setPrice} error={errors.price} required />
      <TextField label={tr('loyalty.fields.validity_days')} value={validity} onChangeText={(v) => setValidity(digits(v).slice(0, 4))} keyboardType="number-pad" placeholder={tr('loyalty.fields.no_expiry')} />
      <SwitchRow label={tr('loyalty.fields.is_active')} value={active} onValueChange={setActive} />
      <SheetFooter onSave={submit} saving={savePackage.isPending} onDelete={pkg ? remove : undefined} deleteLabel={tr('loyalty.packages.delete')} />
    </>
  );
}

// ─── Subscription plan ─────────────────────────────────────────────────────

function PlanForm({ onClose, plan }: { onClose: () => void; plan: LoyaltyPlan | null }) {
  const { t: tr } = useLocale();
  const confirm = useConfirm();
  const { savePlan, deletePlan } = useLoyaltyMutations();
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [price, setPrice] = useState(plan ? String(Number(plan.price)) : '');
  const [months, setMonths] = useState(String(plan?.period_months ?? 1));
  const [uses, setUses] = useState(plan?.uses_per_period ? String(plan.uses_per_period) : '');
  const [svc, setSvc] = useState<string[]>(plan?.services.map((s) => s.uuid) ?? []);
  const [cats, setCats] = useState<string[]>(plan?.categories.map((c) => c.uuid) ?? []);
  const [active, setActive] = useState(plan?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});


  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('mobile.loyalty.required');
    if (!(Number(price) > 0)) e.price = tr('loyalty.validation.price');
    if (!svc.length && !cats.length) e.eligibility = tr('loyalty.validation.eligibility');
    setErrors(e);
    if (Object.keys(e).length) return;
    savePlan.mutate(
      {
        uuid: plan?.uuid,
        body: { name: name.trim(), description: description.trim(), price, period_months: Number(months), uses_per_period: intOrNull(uses), service_uuids: svc, category_uuids: cats, is_active: active },
      },
      { onSuccess: onClose },
    );
  };

  const remove = async () => {
    if (!plan) return;
    if (await confirm({ title: tr('loyalty.plans.delete'), message: tr('loyalty.plans.delete_confirm'), destructive: true, confirmLabel: tr('loyalty.plans.delete') }))
      deletePlan.mutate(plan.uuid, { onSuccess: onClose });
  };

  return (
    <>
      <Txt tone="secondary" variant="caption">
        {tr('loyalty.plans.form_hint')}
      </Txt>
      <TextField label={tr('loyalty.fields.name')} value={name} onChangeText={setName} placeholder={tr('loyalty.plans.name_placeholder')} error={errors.name} required />
      <TextField label={tr('loyalty.fields.description')} value={description} onChangeText={setDescription} multiline />
      <MoneyField label={tr('loyalty.fields.price_per_period')} value={price} onChangeText={setPrice} error={errors.price} required />
      <SelectField
        label={tr('loyalty.fields.period')}
        value={months}
        onChange={(v) => v && setMonths(v)}
        required
        options={[1, 2, 3, 6, 12].map((m) => ({ value: String(m), label: tr('loyalty.period.months', { count: m }) }))}
      />
      <TextField label={tr('loyalty.fields.uses_per_period')} value={uses} onChangeText={(v) => setUses(digits(v).slice(0, 4))} keyboardType="number-pad" placeholder={tr('loyalty.fields.unlimited')} />
      <EligibilityPicker services={svc} categories={cats} onServices={setSvc} onCategories={setCats} error={errors.eligibility} />
      <SwitchRow label={tr('loyalty.fields.is_active')} value={active} onValueChange={setActive} />
      <SheetFooter onSave={submit} saving={savePlan.isPending} onDelete={plan ? remove : undefined} deleteLabel={tr('loyalty.plans.delete')} />
    </>
  );
}

// ─── Sheets (the form remounts on every open, so it starts from the record) ──

const formKey = (visible: boolean, uuid?: string) => `${visible ? 'open' : 'closed'}:${uuid ?? 'new'}`;

export function CampaignSheet({ visible, onClose, campaign }: { visible: boolean; onClose: () => void; campaign: LoyaltyCampaign | null }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={campaign ? tr('loyalty.campaigns.edit') : tr('loyalty.campaigns.new')}>
      <CampaignForm key={formKey(visible, campaign?.uuid)} onClose={onClose} campaign={campaign} />
    </Sheet>
  );
}

export function PackageSheet({ visible, onClose, pkg }: { visible: boolean; onClose: () => void; pkg: LoyaltyPackage | null }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={pkg ? tr('loyalty.packages.edit') : tr('loyalty.packages.new')}>
      <PackageForm key={formKey(visible, pkg?.uuid)} onClose={onClose} pkg={pkg} />
    </Sheet>
  );
}

export function PlanSheet({ visible, onClose, plan }: { visible: boolean; onClose: () => void; plan: LoyaltyPlan | null }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={plan ? tr('loyalty.plans.edit') : tr('loyalty.plans.new')}>
      <PlanForm key={formKey(visible, plan?.uuid)} onClose={onClose} plan={plan} />
    </Sheet>
  );
}
