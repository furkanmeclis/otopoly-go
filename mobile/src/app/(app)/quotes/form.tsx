/**
 * Quote editor — web `/quotes/new` and `/quotes/[uuid]/edit` (`features/quotes/components/quote-editor.tsx`).
 * `?id=` edits; `?lead=` / `?customer=` prefill a new quote.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Car, Package, PenLine, Send, Trash2, Wrench } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BrandLogo, Button, Card, EmptyState, ErrorState, Field, Header, IconButton, InfoRow, ListSkeleton, Row, Screen, Section, Segmented, SelectField, SwitchRow, TextField, Txt, DateField } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { QuotesModuleGate } from '@/features/billing/components/module-gate';
import { P } from '@/features/auth/permissions';
import { catalogService, type CatalogProduct, type CatalogService } from '@/features/catalog/services/catalog.service';
import { CustomerPicker, VehicleModelPicker } from '@/features/customers/components/pickers';
import type { Customer } from '@/features/customers/services/customers.service';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { Chip, ChipRow } from '@/features/leads/components/crm-ui';
import { pickedCustomer } from '@/features/leads/lib/lead-ui';
import { qk, useCustomer, useLead, useQuote } from '@/features/queries';
import { computeDraftTotals } from '@/features/quotes/lib/quote-ui';
import { useQuoteMutations } from '@/features/quotes/queries';
import type { DiscountType, QuoteDetail, SaveQuoteInput } from '@/features/quotes/types';
import { createLogger } from '@/lib/logger';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.quote-form');

type LineType = 'service' | 'product' | 'custom';
type EditorLine = {
  key: string;
  line_type: LineType;
  ref_uuid?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_type: DiscountType;
  discount_value: string;
  vat_rate: string;
};
type VehicleMode = 'none' | 'existing' | 'free';
type EditorState = {
  customer: Customer | null;
  leadUuid: string | null;
  vehicleMode: VehicleMode;
  vehicleUuid: string;
  plate: string;
  label: string;
  catalog: string | null; // "modelUuid:year"
  pricesIncludeVat: boolean;
  discountType: DiscountType;
  discountValue: string;
  validUntil: string;
  notes: string;
  terms: string;
  lines: EditorLine[];
};

const newKey = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function stateFromQuote(q: QuoteDetail): EditorState {
  const hasFree = !q.vehicle_uuid && Boolean(q.vehicle_plate || q.vehicle_label || q.vehicle_model_uuid);
  return {
    customer: pickedCustomer(q.customer_uuid, q.customer_name, q.customer_phone),
    leadUuid: q.lead_uuid ?? null,
    vehicleMode: q.vehicle_uuid ? 'existing' : hasFree ? 'free' : 'none',
    vehicleUuid: q.vehicle_uuid ?? '',
    plate: q.vehicle_plate,
    label: q.vehicle_label,
    catalog: q.vehicle_model_uuid && q.vehicle_year ? `${q.vehicle_model_uuid}:${q.vehicle_year}` : null,
    pricesIncludeVat: q.prices_include_vat,
    discountType: q.discount_type,
    discountValue: q.discount_value === '0.00' ? '' : q.discount_value,
    validUntil: q.valid_until ?? '',
    notes: q.notes,
    terms: q.terms,
    lines: q.lines.map((l) => ({
      key: newKey(),
      line_type: l.line_type,
      ref_uuid: l.service_uuid ?? l.product_uuid ?? undefined,
      description: l.description,
      quantity: l.quantity.replace(/\.?0+$/, '') || '1',
      unit: l.unit,
      unit_price: l.unit_price,
      discount_type: l.discount_type,
      discount_value: l.discount_value === '0.00' ? '' : l.discount_value,
      vat_rate: l.vat_rate.replace(/\.00$/, ''),
    })),
  };
}

function emptyState(): EditorState {
  return {
    customer: null,
    leadUuid: null,
    vehicleMode: 'none',
    vehicleUuid: '',
    plate: '',
    label: '',
    catalog: null,
    pricesIncludeVat: true,
    discountType: 'none',
    discountValue: '',
    validUntil: shiftDate(localToday(), 15),
    notes: '',
    terms: '',
    lines: [],
  };
}

export default function QuoteFormScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.quotesWrite} title={tr('quotes.editor.new_title')}>
      <QuotesModuleGate area="quotes" title={tr('quotes.editor.new_title')}>
        <QuoteFormEntry />
      </QuotesModuleGate>
    </RequirePermission>
  );
}

function QuoteFormEntry() {
  const { t: tr } = useLocale();
  const { id, lead: leadParam, customer: customerParam } = useLocalSearchParams<{ id?: string; lead?: string; customer?: string }>();
  const existing = useQuote(id ?? '');
  const lead = useLead(id ? '' : (leadParam ?? ''));
  const prefill = useCustomer(id || leadParam ? null : customerParam);
  const title = id ? tr('quotes.actions.edit') : tr('quotes.editor.new_title');
  const skeleton = (
    <Screen header={<Header title={title} />}>
      <ListSkeleton rows={4} height={90} />
    </Screen>
  );

  if (id) {
    if (existing.isLoading) return skeleton;
    if (existing.isError) {
      return (
        <Screen header={<Header title={title} />}>
          <ErrorState error={existing.error} description={tr('quotes.error')} onRetry={() => existing.refetch()} />
        </Screen>
      );
    }
    if (!existing.data) {
      return (
        <Screen header={<Header title={title} />}>
          <EmptyState title={tr('quotes.not_found')} />
        </Screen>
      );
    }
    if (!existing.data.can_edit) {
      return (
        <Screen header={<Header title={title} />}>
          <EmptyState title={tr('quotes.editor.locked')} action={<Button variant="outline" size="sm" label={tr('quotes.back_to_quote')} onPress={() => router.replace(`/quotes/${id}`)} />} />
        </Screen>
      );
    }
    return <QuoteEditor key={existing.data.uuid} quote={existing.data} initial={stateFromQuote(existing.data)} />;
  }
  if ((leadParam && lead.isLoading) || (customerParam && !leadParam && prefill.isLoading)) return skeleton;
  if (leadParam && lead.isError) {
    return (
      <Screen header={<Header title={title} />}>
        <ErrorState error={lead.error} description={tr('leads.error')} onRetry={() => lead.refetch()} />
      </Screen>
    );
  }
  if (customerParam && !leadParam && prefill.isError) {
    return (
      <Screen header={<Header title={title} />}>
        <ErrorState error={prefill.error} description={tr('customers.error_description')} onRetry={() => prefill.refetch()} />
      </Screen>
    );
  }
  const initial = emptyState();
  if (lead.data) {
    initial.customer = pickedCustomer(lead.data.customer_uuid, lead.data.customer_name, lead.data.customer_phone);
    initial.leadUuid = lead.data.uuid;
    if (lead.data.vehicle_uuid) {
      initial.vehicleMode = 'existing';
      initial.vehicleUuid = lead.data.vehicle_uuid;
    } else if (lead.data.vehicle_text) {
      initial.vehicleMode = 'free';
      initial.label = lead.data.vehicle_text;
    }
    initial.notes = lead.data.interest;
  } else if (prefill.data) {
    initial.customer = prefill.data;
  }
  return <QuoteEditor key={lead.data?.uuid ?? prefill.data?.uuid ?? 'new'} initial={initial} leadLabel={lead.data?.interest} />;
}

type CatalogEntry = { type: 'service'; item: CatalogService } | { type: 'product'; item: CatalogProduct };

function useCatalogSearch(q: string) {
  return useQuery({
    queryKey: [...qk.catalog, 'quote-pick', q],
    queryFn: async () => {
      const query = q || undefined;
      const [services, products] = await Promise.all([
        catalogService.listServices({ limit: 15, offset: 0, q: query, is_active: 'true', sort: 'name' }).catch(() => ({ items: [] as CatalogService[] })),
        catalogService.listProducts({ limit: 15, offset: 0, q: query, is_active: 'true', sort: 'name' }).catch(() => ({ items: [] as CatalogProduct[] })),
      ]);
      const entries: Record<string, CatalogEntry> = {};
      for (const s of services.items) entries[`s:${s.uuid}`] = { type: 'service', item: s };
      for (const p of products.items) entries[`p:${p.uuid}`] = { type: 'product', item: p };
      return entries;
    },
    placeholderData: keepPreviousData,
  });
}

function QuoteEditor({ quote, initial, leadLabel }: { quote?: QuoteDetail; initial: EditorState; leadLabel?: string }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [s, setS] = useState<EditorState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { create, update } = useQuoteMutations();
  const customerQuery = useCustomer(s.customer?.uuid);
  const vehicles = customerQuery.data?.vehicles ?? [];
  const pending = create.isPending || update.isPending;
  const serverErrs = fieldErrors(quote ? update.error : create.error);
  const [catalogQ, setCatalogQ] = useState('');
  const catalog = useCatalogSearch(catalogQ.trim());

  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const totals = useMemo(
    () =>
      computeDraftTotals(
        s.lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price, discount_type: l.discount_type, discount_value: l.discount_value, vat_rate: l.vat_rate })),
        s.discountType,
        s.discountValue,
        s.pricesIncludeVat,
      ),
    [s.lines, s.discountType, s.discountValue, s.pricesIncludeVat],
  );
  const money = (v: string) => fmt.money(v, quote?.currency ?? 'TRY');

  const updateLine = (key: string, patch: Partial<EditorLine>) => setS((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setS((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.key !== key) }));
  const addCustom = () => {
    setErrors((e) => ({ ...e, lines: '' }));
    setS((prev) => ({
      ...prev,
      lines: [...prev.lines, { key: newKey(), line_type: 'custom', description: '', quantity: '1', unit: '', unit_price: '', discount_type: 'none', discount_value: '', vat_rate: '20' }],
    }));
  };
  const pickCatalog = (value: string | null) => {
    const entry = value ? catalog.data?.[value] : undefined;
    if (!entry) return;
    setErrors((e) => ({ ...e, lines: '' }));
    const item = entry.item;
    setS((prev) => {
      const existing = prev.lines.find((l) => l.ref_uuid === item.uuid);
      if (existing) {
        // Same item again → bump quantity.
        const qty = (Number(existing.quantity.replace(',', '.')) || 0) + 1;
        return { ...prev, lines: prev.lines.map((l) => (l.key === existing.key ? { ...l, quantity: String(qty) } : l)) };
      }
      return {
        ...prev,
        lines: [
          ...prev.lines,
          {
            key: newKey(),
            line_type: entry.type,
            ref_uuid: item.uuid,
            description: item.name,
            quantity: '1',
            unit: entry.type === 'product' ? entry.item.unit : '',
            unit_price: entry.type === 'service' ? entry.item.price : entry.item.sale_price,
            discount_type: 'none',
            discount_value: '',
            vat_rate: String(Number(item.vat_rate)),
          },
        ],
      };
    });
  };
  const catalogOptions = useMemo(
    () =>
      Object.entries(catalog.data ?? {}).map(([value, e]) => ({
        value,
        label: e.item.name,
        description: `${tr(`quotes.line_type.${e.type}`)} · ${fmt.money(e.type === 'service' ? e.item.price : e.item.sale_price, e.item.currency)}`,
        left: e.type === 'service' ? <Wrench size={16} color={t.colors.textMuted} /> : <Package size={16} color={t.colors.textMuted} />,
      })),
    [catalog.data, tr, fmt, t.colors.textMuted],
  );

  const buildBody = (): SaveQuoteInput | null => {
    const errs: Record<string, string> = {};
    if (!s.customer) errs.customer = tr('quotes.validation.customer');
    if (s.lines.length === 0) errs.lines = tr('quotes.validation.lines');
    s.lines.forEach((l) => {
      if (!l.description.trim()) errs[`d:${l.key}`] = tr('quotes.validation.description');
      if (!(Number(l.quantity.replace(',', '.')) > 0)) errs[`q:${l.key}`] = tr('quotes.validation.quantity');
      if (l.unit_price.trim() === '' || Number.isNaN(Number(l.unit_price.replace(',', '.')))) errs[`p:${l.key}`] = tr('quotes.validation.price');
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !s.customer) return null;
    let vehicle: SaveQuoteInput['vehicle'] = null;
    if (s.vehicleMode === 'existing' && s.vehicleUuid) vehicle = { vehicle_uuid: s.vehicleUuid };
    if (s.vehicleMode === 'free') {
      const [modelUuid, year] = s.catalog ? s.catalog.split(':') : [];
      vehicle = { plate: s.plate.trim(), label: s.label.trim(), model_uuid: modelUuid || null, year: year ? Number(year) : null };
    }
    const norm = (v: string) => v.trim().replace(',', '.');
    return {
      customer_uuid: s.customer.uuid,
      lead_uuid: s.leadUuid,
      vehicle,
      currency: quote?.currency ?? 'TRY',
      prices_include_vat: s.pricesIncludeVat,
      discount_type: s.discountType,
      discount_value: norm(s.discountValue) || '0',
      valid_until: s.validUntil,
      notes: s.notes,
      terms: s.terms,
      lines: s.lines.map((l) => ({
        line_type: l.line_type,
        service_uuid: l.line_type === 'service' ? l.ref_uuid : null,
        product_uuid: l.line_type === 'product' ? l.ref_uuid : null,
        description: l.description.trim(),
        quantity: norm(l.quantity),
        unit: l.unit.trim(),
        unit_price: norm(l.unit_price),
        discount_type: l.discount_type,
        discount_value: norm(l.discount_value) || '0',
        vat_rate: norm(l.vat_rate) || '0',
      })),
    };
  };

  const save = (andSend: boolean) => {
    const body = buildBody();
    if (!body) return;
    const done = (saved: QuoteDetail) => {
      log.info('Quote saved', { uuid: saved.uuid, andSend });
      const target = { pathname: '/quotes/[id]' as const, params: andSend ? { id: saved.uuid, send: '1' } : { id: saved.uuid } };
      if (quote) {
        router.dismissTo(target);
      } else {
        router.replace(target);
      }
    };
    if (quote) update.mutate({ uuid: quote.uuid, body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  };

  return (
    <Screen
      header={<Header title={quote ? tr('quotes.editor.edit_title', { number: quote.number }) : tr('quotes.editor.new_title')} />}
      footer={
        <Row gap={t.spacing.sm}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="caption" tone="muted">
              {tr('quotes.fields.grand_total')}
            </Txt>
            <Txt variant="heading" tone="primary" numberOfLines={1} adjustsFontSizeToFit>
              {money(totals.grand)}
            </Txt>
          </View>
          <Button variant="outline" size="sm" label={quote ? tr('common.save') : tr('quotes.actions.save_draft')} disabled={pending} onPress={() => save(false)} />
          <Button size="sm" label={tr('quotes.actions.send_short')} icon={<Send size={16} color={t.colors.onPrimary} />} loading={pending} onPress={() => save(true)} />
        </Row>
      }
    >
      {/* Customer + vehicle */}
      <Card style={{ gap: t.spacing.md }}>
        <CustomerPicker
          label={tr('quotes.fields.customer')}
          value={s.customer}
          error={errors.customer || serverErrs.customer_uuid}
          onChange={(c) => {
            setErrors((e) => ({ ...e, customer: '' }));
            setS((prev) => ({
              ...prev,
              customer: c,
              vehicleUuid: '',
              vehicleMode: prev.vehicleMode === 'existing' ? 'none' : prev.vehicleMode,
              leadUuid: c && prev.customer?.uuid === c.uuid ? prev.leadUuid : null,
            }));
          }}
        />
        {s.leadUuid ? (
          <Txt variant="caption" tone="muted">
            {tr('quotes.editor.from_lead')}
            {leadLabel ? `: ${leadLabel}` : ''}
          </Txt>
        ) : null}
        <Field label={tr('quotes.fields.vehicle')}>
          <Segmented<VehicleMode>
            value={s.vehicleMode}
            onChange={(mode) => (mode === 'existing' && vehicles.length === 0 ? undefined : set('vehicleMode', mode))}
            options={(['none', 'existing', 'free'] as VehicleMode[]).map((mode) => ({ value: mode, label: tr(`quotes.vehicle_mode.${mode}`) }))}
          />
          {s.vehicleMode === 'existing' && vehicles.length === 0 ? (
            <Txt variant="caption" tone="muted">
              {tr('customers.detail.no_vehicles')}
            </Txt>
          ) : null}
        </Field>
        {s.vehicleMode === 'existing' && vehicles.length > 0 ? (
          <SelectField
            placeholder={tr('quotes.editor.pick_vehicle')}
            value={s.vehicleUuid || null}
            onChange={(v) => set('vehicleUuid', v ?? '')}
            options={vehicles.map((v) => ({ value: v.uuid, label: `${v.plate} · ${v.brand_name} ${v.model_name} ${v.year}`, left: <BrandLogo name={v.brand_name} logoUrl={v.logo_url} size="sm" /> }))}
          />
        ) : null}
        {s.vehicleMode === 'free' ? (
          <>
            <TextField
              placeholder={tr('quotes.editor.plate_optional')}
              value={s.plate}
              onChangeText={(v) => set('plate', v.toLocaleUpperCase('tr-TR'))}
              maxLength={16}
              autoCapitalize="characters"
              autoCorrect={false}
              left={<Car size={16} color={t.colors.textMuted} />}
            />
            <TextField placeholder={tr('quotes.editor.vehicle_label')} value={s.label} onChangeText={(v) => set('label', v)} maxLength={200} />
            <VehicleModelPicker label={tr('quotes.editor.vehicle_catalog')} value={s.catalog} onChange={(v) => set('catalog', v)} />
          </>
        ) : null}
      </Card>

      {/* Lines */}
      <Section title={tr('quotes.lines')}>
        <SelectField
          placeholder={tr('quotes.editor.add_catalog')}
          value={null}
          options={catalogOptions}
          onSearch={setCatalogQ}
          loading={catalog.isFetching}
          onChange={pickCatalog}
        />
        <Button variant="outline" size="sm" label={tr('quotes.editor.add_custom')} icon={<PenLine size={16} color={t.colors.text} />} onPress={addCustom} />
        {s.lines.length === 0 ? (
          <Card>
            <Txt tone={errors.lines ? 'danger' : 'muted'} style={{ textAlign: 'center' }}>
              {errors.lines || serverErrs.lines || tr('quotes.editor.no_lines')}
            </Txt>
          </Card>
        ) : (
          s.lines.map((l, i) => {
            const Icon = l.line_type === 'service' ? Wrench : l.line_type === 'product' ? Package : PenLine;
            return (
              <Card key={l.key} style={{ gap: t.spacing.sm }}>
                <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
                  <View style={{ paddingTop: 14 }} accessibilityLabel={tr(`quotes.line_type.${l.line_type}`)}>
                    <Icon size={18} color={t.colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      value={l.description}
                      onChangeText={(v) => updateLine(l.key, { description: v })}
                      placeholder={tr('quotes.fields.description')}
                      accessibilityLabel={tr('quotes.fields.description')}
                      maxLength={300}
                      error={errors[`d:${l.key}`] || serverErrs[`lines[${i}].description`]}
                    />
                  </View>
                  <IconButton variant="ghost" label={tr('common.delete')} icon={<Trash2 size={18} color={t.colors.danger} />} onPress={() => removeLine(l.key)} style={{ marginTop: 4 }} />
                </Row>
                <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <DecimalField label={tr('quotes.fields.quantity')} value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: v })} error={errors[`q:${l.key}`]} />
                  </View>
                  <View style={{ flex: 1.4 }}>
                    <DecimalField label={tr('quotes.fields.unit_price')} value={l.unit_price} onChange={(v) => updateLine(l.key, { unit_price: v })} error={errors[`p:${l.key}`] || serverErrs[`lines[${i}].unit_price`]} />
                  </View>
                  <View style={{ flex: 0.9 }}>
                    <DecimalField label={tr('quotes.fields.vat')} value={l.vat_rate} onChange={(v) => updateLine(l.key, { vat_rate: v })} />
                  </View>
                </Row>
                <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <DiscountInput type={l.discount_type} value={l.discount_value} onChange={(discount_type, discount_value) => updateLine(l.key, { discount_type, discount_value })} />
                  </View>
                  <Txt variant="mono">{money(totals.lines[i]?.total ?? '0')}</Txt>
                </Row>
              </Card>
            );
          })
        )}
      </Section>

      <TextField label={tr('quotes.fields.notes')} value={s.notes} onChangeText={(v) => set('notes', v)} multiline />
      <TextField label={tr('quotes.fields.terms')} value={s.terms} onChangeText={(v) => set('terms', v)} placeholder={tr('quotes.editor.terms_placeholder')} multiline />

      {/* Totals */}
      <Card style={{ gap: t.spacing.md }}>
        <DateField label={tr('quotes.fields.valid_until')} value={s.validUntil || null} onChange={(v) => set('validUntil', v ?? '')} allowClear error={serverErrs.valid_until} />
        <ChipRow>
          {[7, 15, 30].map((d) => (
            <Chip key={d} label={tr('quotes.editor.days', { days: d })} active={s.validUntil === shiftDate(localToday(), d)} onPress={() => set('validUntil', shiftDate(localToday(), d))} />
          ))}
          <Chip label={tr('quotes.editor.no_expiry')} active={!s.validUntil} onPress={() => set('validUntil', '')} />
        </ChipRow>
        <SwitchRow label={tr('quotes.fields.prices_include_vat')} value={s.pricesIncludeVat} onValueChange={(v) => set('pricesIncludeVat', v)} />
        <Field label={tr('quotes.fields.quote_discount')}>
          <DiscountInput type={s.discountType} value={s.discountValue} onChange={(type, value) => setS((prev) => ({ ...prev, discountType: type, discountValue: value }))} />
        </Field>
        <View>
          <InfoRow label={tr('quotes.fields.subtotal')} value={money(totals.subtotal)} />
          {totals.discount !== '0.00' ? <InfoRow label={tr('quotes.fields.discount_total')} value={`-${money(totals.discount)}`} /> : null}
          <InfoRow label={s.pricesIncludeVat ? tr('quotes.fields.vat_included') : tr('quotes.fields.vat_total')} value={money(totals.vat)} />
          <InfoRow label={tr('quotes.fields.grand_total')} last>
            <Txt variant="title" tone="primary">
              {money(totals.grand)}
            </Txt>
          </InfoRow>
        </View>
        <Txt variant="caption" tone="muted">
          {tr('quotes.editor.server_totals')}
        </Txt>
      </Card>
    </Screen>
  );
}

function DecimalField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={(raw) => onChange(raw.replace(/[^0-9.,]/g, ''))}
      keyboardType="decimal-pad"
      inputMode="decimal"
      error={error}
      style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }}
    />
  );
}

/** Web DiscountInput: tap the symbol to cycle none → % → ₺. */
function DiscountInput({ type, value, onChange }: { type: DiscountType; value: string; onChange: (type: DiscountType, value: string) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const cycle: DiscountType[] = ['none', 'percent', 'amount'];
  const symbol = type === 'percent' ? '%' : type === 'amount' ? '₺' : '—';
  return (
    <Row gap={t.spacing.sm}>
      <Pressable
        onPress={() => {
          const next = cycle[(cycle.indexOf(type) + 1) % cycle.length]!;
          onChange(next, next === 'none' ? '' : value);
        }}
        accessibilityRole="button"
        accessibilityLabel={tr(`quotes.discount_type.${type}`)}
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: t.radius.md,
          borderWidth: 1.5,
          borderColor: type === 'none' ? t.colors.border : t.colors.primary,
          backgroundColor: type === 'none' ? t.colors.surface : t.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Txt variant="bodyStrong" style={{ color: type === 'none' ? t.colors.textSecondary : t.colors.primary }}>
          {symbol}
        </Txt>
      </Pressable>
      <View style={{ flex: 1 }}>
        <TextField
          value={type === 'none' ? '' : value}
          editable={type !== 'none'}
          placeholder={type === 'none' ? tr('quotes.discount_type.none') : '0'}
          onChangeText={(raw) => onChange(type, raw.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          accessibilityLabel={tr('quotes.fields.discount')}
          style={{ textAlign: 'right' }}
        />
      </View>
    </Row>
  );
}
