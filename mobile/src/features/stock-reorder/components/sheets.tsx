import { Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, IconButton, Row, Segmented, SelectField, Sheet, SwitchRow, TextField, Txt } from '@/components/ui';
import type { PurchaseDetail, PurchaseMethod } from '@/features/purchases/services/purchases.service';
import { useFinanceAccounts } from '@/features/queries';
import { defaultAccountUuid, sanitizeDecimal } from '@/features/sales/components/commerce-parts';
import { useSupplierSearch } from '@/features/suppliers/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { qtyString } from '../lib/reorder';
import { useReorderMutations, useReorderSettings } from '../queries';
import type { ReorderSettings, ReorderSuggestion } from '../types';
import { QtyStepper } from './qty-stepper';

const toInt = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
};
const digits = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 3);

// ─── Settings ───────────────────────────────────────────────────────────────

/** Organization reorder settings (web `ReorderSettingsDialog`). Body is keyed so it starts from the saved values. */
export function ReorderSettingsSheet({ visible, onClose, canWrite }: { visible: boolean; onClose: () => void; canWrite: boolean }) {
  const { t: tr } = useLocale();
  const settings = useReorderSettings(visible);
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('stock_reorder.settings.title')}>
      {settings.data ? (
        <SettingsBody key={settings.dataUpdatedAt} data={settings.data} canWrite={canWrite} onDone={onClose} />
      ) : (
        <Txt tone="secondary">{tr('common.loading')}</Txt>
      )}
    </Sheet>
  );
}

function SettingsBody({ data, canWrite, onDone }: { data: ReorderSettings; canWrite: boolean; onDone: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { updateSettings } = useReorderMutations();
  const [velocity, setVelocity] = useState(String(data.velocity_days));
  const [lead, setLead] = useState(String(data.lead_days));
  const [target, setTarget] = useState(String(data.target_days));
  const [notify, setNotify] = useState(data.notify_enabled);
  const [leads, setLeads] = useState(() => data.supplier_lead_days.map((l) => ({ uuid: l.supplier_uuid, name: l.supplier_name ?? '', days: String(l.lead_days) })));
  const [supplierQ, setSupplierQ] = useState('');
  const suppliers = useSupplierSearch(supplierQ, canWrite);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const leadDays = toInt(lead);
    const targetDays = toInt(target);
    if (!(leadDays >= 0 && leadDays <= 180) || leads.some((l) => !(toInt(l.days) >= 0 && toInt(l.days) <= 180))) {
      setError(tr('stock_reorder.settings.validation.lead'));
      return;
    }
    if (!(targetDays >= 1 && targetDays <= 365)) {
      setError(tr('stock_reorder.settings.validation.target'));
      return;
    }
    setError(null);
    updateSettings.mutate(
      {
        velocity_days: toInt(velocity),
        lead_days: leadDays,
        target_days: targetDays,
        notify_enabled: notify,
        supplier_lead_days: leads.map((l) => ({ supplier_uuid: l.uuid, lead_days: toInt(l.days) })),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <View style={{ gap: t.spacing.lg }}>
      <View style={{ gap: t.spacing.sm }}>
        <Txt variant="label">{tr('stock_reorder.settings.velocity_days')}</Txt>
        <Segmented<string>
          value={velocity}
          onChange={(v) => canWrite && setVelocity(v)}
          options={data.velocity_day_options.map((d) => ({ value: String(d), label: tr('mobile.reorder.days_short', { count: d }) }))}
        />
        <Txt variant="caption" tone="secondary">
          {tr('stock_reorder.settings.velocity_hint')}
        </Txt>
      </View>
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <TextField label={tr('stock_reorder.settings.lead_days')} value={lead} onChangeText={(v) => setLead(digits(v))} keyboardType="number-pad" editable={canWrite} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={tr('stock_reorder.settings.target_days')} value={target} onChangeText={(v) => setTarget(digits(v))} keyboardType="number-pad" editable={canWrite} />
        </View>
      </Row>
      <SwitchRow
        label={tr('stock_reorder.settings.notify')}
        description={tr('stock_reorder.settings.notify_hint', { time: data.notify_time })}
        value={notify}
        onValueChange={setNotify}
        disabled={!canWrite}
      />
      <View style={{ gap: t.spacing.sm }}>
        <Txt variant="label">{tr('stock_reorder.settings.supplier_leads')}</Txt>
        <Txt variant="caption" tone="secondary">
          {tr('stock_reorder.settings.supplier_leads_hint')}
        </Txt>
        {leads.map((l) => (
          <Card key={l.uuid} style={{ paddingVertical: t.spacing.sm }}>
            <Row gap={t.spacing.sm}>
              <Txt style={{ flex: 1 }} numberOfLines={1}>
                {l.name}
              </Txt>
              <View style={{ width: 72 }}>
                <TextField
                  value={l.days}
                  onChangeText={(v) => setLeads((prev) => prev.map((x) => (x.uuid === l.uuid ? { ...x, days: digits(v) } : x)))}
                  keyboardType="number-pad"
                  editable={canWrite}
                  accessibilityLabel={`${l.name} ${tr('stock_reorder.settings.lead_days')}`}
                />
              </View>
              {canWrite ? (
                <IconButton variant="ghost" label={tr('common.delete')} icon={<Trash2 size={18} color={t.colors.danger} />} onPress={() => setLeads((prev) => prev.filter((x) => x.uuid !== l.uuid))} />
              ) : null}
            </Row>
          </Card>
        ))}
        {canWrite ? (
          <SelectField
            value={null}
            placeholder={tr('stock_reorder.settings.add_supplier')}
            searchable
            onSearch={setSupplierQ}
            loading={suppliers.isFetching}
            options={(suppliers.data?.items ?? []).filter((s) => !leads.some((l) => l.uuid === s.uuid)).map((s) => ({ value: s.uuid, label: s.name }))}
            onChange={(value, option) => {
              if (value && option) setLeads((prev) => [...prev, { uuid: value, name: option.label, days: lead }]);
            }}
          />
        ) : null}
      </View>
      {error ? <Txt tone="danger">{error}</Txt> : null}
      {canWrite ? <Button label={tr('common.save')} onPress={save} loading={updateSettings.isPending} fullWidth /> : null}
    </View>
  );
}

// ─── Product override ───────────────────────────────────────────────────────

/** Per-product supplier, lead time, target cover and pack size (web `ReorderOverrideDialog`). */
export function ReorderOverrideSheet({ item, onClose }: { item: ReorderSuggestion | null; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={item !== null} onClose={onClose} title={tr('stock_reorder.override.title')}>
      {item ? <OverrideBody key={item.product_uuid} item={item} onDone={onClose} /> : null}
    </Sheet>
  );
}

function OverrideBody({ item, onDone }: { item: ReorderSuggestion; onDone: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { setOverride } = useReorderMutations();
  const o = item.override;
  const [supplier, setSupplier] = useState<{ uuid: string; name: string } | null>(o?.supplier_uuid ? { uuid: o.supplier_uuid, name: o.supplier_name ?? '' } : null);
  const [lead, setLead] = useState(o?.lead_days != null ? String(o.lead_days) : '');
  const [target, setTarget] = useState(o?.target_days != null ? String(o.target_days) : '');
  const [pack, setPack] = useState(o?.pack_size ?? '');
  const [supplierQ, setSupplierQ] = useState('');
  const suppliers = useSupplierSearch(supplierQ);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const list = (suppliers.data?.items ?? []).map((s) => ({ value: s.uuid, label: s.name }));
    return supplier && !list.some((s) => s.value === supplier.uuid) ? [{ value: supplier.uuid, label: supplier.name }, ...list] : list;
  }, [supplier, suppliers.data]);

  const save = (clear: boolean) => {
    const leadDays = lead ? toInt(lead) : null;
    const targetDays = target ? toInt(target) : null;
    if (!clear && leadDays !== null && !(leadDays >= 0 && leadDays <= 180)) return setError(tr('stock_reorder.settings.validation.lead'));
    if (!clear && targetDays !== null && !(targetDays >= 1 && targetDays <= 365)) return setError(tr('stock_reorder.settings.validation.target'));
    if (!clear && pack && !(toNumber(pack) > 0)) return setError(tr('stock_reorder.override.validation.pack'));
    setError(null);
    setOverride.mutate(
      {
        productUuid: item.product_uuid,
        body: clear ? {} : { supplier_uuid: supplier?.uuid ?? null, lead_days: leadDays, target_days: targetDays, pack_size: pack || null },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt tone="secondary">{tr('stock_reorder.override.description', { name: item.name })}</Txt>
      <SelectField
        label={tr('stock_reorder.override.supplier')}
        value={supplier?.uuid ?? null}
        placeholder={item.supplier?.source === 'last_purchase' ? tr('stock_reorder.override.supplier_auto', { name: item.supplier.name }) : tr('purchases.pick_supplier')}
        searchable
        allowClear
        onSearch={setSupplierQ}
        loading={suppliers.isFetching}
        options={options}
        onChange={(value, option) => setSupplier(value && option ? { uuid: value, name: option.label } : null)}
      />
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <TextField label={tr('stock_reorder.settings.lead_days')} value={lead} placeholder={String(item.inputs.lead_days)} onChangeText={(v) => setLead(digits(v))} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={tr('stock_reorder.settings.target_days')} value={target} placeholder={String(item.inputs.target_days)} onChangeText={(v) => setTarget(digits(v))} keyboardType="number-pad" />
        </View>
      </Row>
      <TextField label={tr('stock_reorder.override.pack_size')} value={pack} placeholder="—" onChangeText={(v) => setPack(sanitizeDecimal(v))} keyboardType="decimal-pad" inputMode="decimal" />
      <Txt variant="caption" tone="secondary">
        {tr('stock_reorder.override.hint')}
      </Txt>
      {error ? <Txt tone="danger">{error}</Txt> : null}
      <Button label={tr('common.save')} onPress={() => save(false)} loading={setOverride.isPending} fullWidth />
      {o ? <Button label={tr('stock_reorder.override.reset')} variant="outline" onPress={() => save(true)} disabled={setOverride.isPending} fullWidth /> : null}
    </View>
  );
}

// ─── Post draft ─────────────────────────────────────────────────────────────

/** "Onayla ve alışa çevir": method, account, received quantities / costs (web `PostDraftDialog`). */
export function PostDraftSheet({ draft, onClose, onPosted }: { draft: PurchaseDetail | null; onClose: () => void; onPosted?: (p: PurchaseDetail) => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={draft !== null} onClose={onClose} title={tr('stock_reorder.post.title')}>
      {draft ? (
        <PostBody
          key={draft.uuid}
          draft={draft}
          onDone={(p) => {
            onClose();
            onPosted?.(p);
          }}
        />
      ) : null}
    </Sheet>
  );
}

function PostBody({ draft, onDone }: { draft: PurchaseDetail; onDone: (p: PurchaseDetail) => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { postDraft } = useReorderMutations();
  const accountsQuery = useFinanceAccounts(true);
  const accounts = useMemo(() => (accountsQuery.data?.items ?? []).filter((a) => a.currency === draft.currency), [accountsQuery.data, draft.currency]);
  const [method, setMethod] = useState<PurchaseMethod>('cash');
  const [picked, setPicked] = useState<string | null>(null);
  const account = picked ?? defaultAccountUuid(accounts);
  const [lines, setLines] = useState(() => draft.lines.map((l) => ({ product_uuid: l.product_uuid, name: l.name, qty: qtyString(toNumber(l.qty)), unit_cost: l.unit_cost })));
  const [error, setError] = useState<string | null>(null);
  const total = lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unit_cost), 0);

  const submit = () => {
    if (!account) return setError(tr('purchases.validation.finance_account'));
    if (lines.some((l) => !(toNumber(l.qty) > 0))) return setError(tr('stock_reorder.validation.qty'));
    if (!(total > 0)) return setError(tr('stock_reorder.validation.total'));
    setError(null);
    postDraft.mutate({ uuid: draft.uuid, body: { method, finance_account_uuid: account, lines: lines.map((l) => ({ product_uuid: l.product_uuid, qty: l.qty, unit_cost: l.unit_cost })) } }, { onSuccess: onDone });
  };

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt tone="secondary">{tr('stock_reorder.post.description', { supplier: draft.supplier_name })}</Txt>
      {lines.map((l, i) => (
        <Card key={l.product_uuid} style={{ gap: t.spacing.sm }}>
          <Txt variant="bodyStrong" numberOfLines={2}>
            {l.name}
          </Txt>
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-end' }}>
            <QtyStepper value={l.qty} onChange={(v) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: v } : x)))} label={`${l.name} ${tr('purchases.qty')}`} />
            <View style={{ flex: 1 }}>
              <TextField
                label={tr('purchases.unit_cost')}
                value={l.unit_cost}
                onChangeText={(v) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, unit_cost: sanitizeDecimal(v, 2) } : x)))}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </View>
          </Row>
        </Card>
      ))}
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt tone="secondary">{tr('purchases.total')}</Txt>
        <Txt variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
          {fmt.money(total, draft.currency)}
        </Txt>
      </Row>
      <Segmented<PurchaseMethod>
        value={method}
        onChange={setMethod}
        options={[
          { value: 'cash', label: tr('purchases.payment_method.cash') },
          { value: 'card', label: tr('purchases.payment_method.card') },
        ]}
      />
      <SelectField
        label={tr('purchases.finance_account')}
        value={account}
        placeholder={tr('purchases.pick_finance_account')}
        options={accounts.map((a) => ({ value: a.uuid, label: `${a.name} (${a.currency})` }))}
        onChange={(v) => setPicked(v)}
      />
      <Txt variant="caption" tone="secondary">
        {tr('stock_reorder.post.hint')}
      </Txt>
      {error ? <Txt tone="danger">{error}</Txt> : null}
      <Button label={tr('stock_reorder.actions.post')} onPress={submit} loading={postDraft.isPending} fullWidth />
    </View>
  );
}
