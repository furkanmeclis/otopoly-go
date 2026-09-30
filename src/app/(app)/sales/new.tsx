import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Header, Screen, Section, Segmented, SelectField, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import type { Customer } from '@/features/customers/services/customers.service';
import { MONEY_KEYS, useFinanceAccounts } from '@/features/queries';
import {
  defaultAccountUuid,
  draftFromProduct,
  DraftLines,
  draftTotal,
  OptionalCustomerPicker,
  ProductPicker,
  TotalRow,
  type DraftLine,
} from '@/features/sales/components/commerce-parts';
import { salesService, type CreateSaleInput, type SaleMethod } from '@/features/sales/services/sales.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.quick_sale');
const SALE_METHODS = ['cash', 'card', 'cari'] as const;

export default function QuickSaleScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.salesWrite} title={tr('sales.quick.title')}>
      <QuickSaleForm />
    </RequirePermission>
  );
}

/** Web `QuickSaleDialog`: optional customer, product lines (stock aware), method → account, cari needs a customer. */
function QuickSaleForm() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const accountsQuery = useFinanceAccounts(true);
  const accounts = useMemo(() => accountsQuery.data?.items ?? [], [accountsQuery.data]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [method, setMethod] = useState<SaleMethod>('cash');
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const account = pickedAccount ?? defaultAccountUuid(accounts);
  const total = draftTotal(lines);
  const currency = lines[0]?.currency ?? 'TRY';
  const cariBlocked = method === 'cari' && !customer;

  const create = useApiMutation({
    key: 'sales.create',
    fn: (body: CreateSaleInput) => salesService.create(body),
    invalidate: MONEY_KEYS,
    success: tr('sales.toast.created'),
    onSuccess: (sale) => {
      log.info('sale created', { uuid: sale.uuid, method: sale.method, total: sale.total_amount });
      router.replace(`/sales/${sale.uuid}`);
    },
  });
  const apiErrors = fieldErrors(create.error);

  const submit = () => {
    const next: Record<string, string> = {};
    if (lines.length === 0) next.lines = tr('sales.validation.lines');
    if (method === 'cari' && !customer) next.customer = tr('sales.validation.cari_customer');
    if (method !== 'cari' && !account) next.account = tr('sales.validation.finance_account');
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate({
      customer_uuid: customer?.uuid ?? null,
      notes: notes.trim() || undefined,
      method,
      finance_account_uuid: method === 'cari' ? undefined : (account ?? undefined),
      lines: lines.map((l) => ({ product_uuid: l.product_uuid, unit_price: l.price || undefined, qty: l.qty || undefined })),
    });
  };

  const lineApiError = Object.entries(apiErrors).find(([k]) => k.startsWith('lines'))?.[1];

  return (
    <Screen
      header={<Header title={tr('sales.quick.title')} subtitle={tr('sales.quick.description')} />}
      footer={
        <Button
          size="lg"
          label={create.isPending ? tr('common.saving') : `${tr('sales.quick.submit')} · ${fmt.money(total, currency)}`}
          loading={create.isPending}
          disabled={cariBlocked}
          onPress={submit}
        />
      }
    >
      <View style={{ gap: 6 }}>
        <OptionalCustomerPicker
          value={customer}
          onChange={(c) => {
            setCustomer(c);
            setErrors((e) => ({ ...e, customer: '' }));
          }}
          error={errors.customer || apiErrors.customer_uuid}
        />
        {cariBlocked && !errors.customer ? (
          <Txt variant="caption" tone="danger">
            {tr('sales.validation.cari_customer')}
          </Txt>
        ) : null}
      </View>

      <Section title={tr('sales.products')}>
        <ProductPicker
          mode="sale"
          selected={lines.map((l) => l.product_uuid)}
          onAdd={(p) => {
            setLines((prev) => (prev.some((l) => l.product_uuid === p.uuid) ? prev : [...prev, draftFromProduct(p, 'sale')]));
            setErrors((e) => ({ ...e, lines: '' }));
          }}
        />
        <DraftLines
          mode="sale"
          lines={lines}
          onChange={(key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))}
          onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
        />
        {errors.lines || lineApiError || apiErrors.lines ? (
          <Txt variant="caption" tone="danger">
            {errors.lines || lineApiError || apiErrors.lines}
          </Txt>
        ) : null}
        <TotalRow label={tr('sales.total')} value={fmt.money(total, currency)} />
      </Section>

      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('sales.method')}
        </Txt>
        <Segmented<SaleMethod> value={method} onChange={setMethod} options={SALE_METHODS.map((m) => ({ value: m, label: tr(`sales.payment_method.${m}`) }))} />
      </View>
      {method !== 'cari' ? (
        <SelectField
          label={tr('sales.finance_account')}
          placeholder={tr('sales.pick_finance_account')}
          value={account}
          onChange={(v) => {
            setPickedAccount(v);
            setErrors((e) => ({ ...e, account: '' }));
          }}
          loading={accountsQuery.isLoading}
          error={errors.account || apiErrors.finance_account_uuid}
          required
          options={accounts.map((a) => ({ value: a.uuid, label: `${a.name} (${a.currency})`, description: fmt.money(a.current_balance, a.currency) }))}
        />
      ) : null}
      <TextField label={tr('sales.notes')} value={notes} onChangeText={setNotes} multiline error={apiErrors.notes} />
      <View style={{ height: t.spacing.sm }} />
    </Screen>
  );
}
