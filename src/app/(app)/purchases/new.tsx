import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, ErrorState, Header, Screen, Section, Segmented, SelectField, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { purchasesService, type CreatePurchaseInput, type PurchaseMethod } from '@/features/purchases/services/purchases.service';
import { MONEY_KEYS, useFinanceAccounts } from '@/features/queries';
import { defaultAccountUuid, draftFromProduct, DraftLines, draftTotal, ProductPicker, TotalRow, type DraftLine } from '@/features/sales/components/commerce-parts';
import { useSupplierSearch } from '@/features/suppliers/queries';
import type { Supplier } from '@/features/suppliers/services/suppliers.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';

const log = createLogger('screen.purchase_new');
const PURCHASE_METHODS = ['cash', 'card'] as const;

export default function NewPurchaseScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={{ perm: P.purchasesWrite, owner: true }} title={tr('purchases.actions.create')}>
      <NewPurchaseForm />
    </RequirePermission>
  );
}

/** Web `CreatePurchaseDialog`: supplier, product lines with unit cost, method, account (required), notes. */
function NewPurchaseForm() {
  const { t: tr, fmt } = useLocale();
  const accountsQuery = useFinanceAccounts(true);
  const accounts = useMemo(() => accountsQuery.data?.items ?? [], [accountsQuery.data]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [supplierQ, setSupplierQ] = useState('');
  const suppliers = useSupplierSearch(supplierQ);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [method, setMethod] = useState<PurchaseMethod>('cash');
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const account = pickedAccount ?? defaultAccountUuid(accounts);
  const total = draftTotal(lines);
  const currency = lines[0]?.currency ?? 'TRY';

  const supplierItems = useMemo(() => {
    const items = suppliers.data?.items ?? [];
    return supplier && !items.some((s) => s.uuid === supplier.uuid) ? [supplier, ...items] : items;
  }, [suppliers.data, supplier]);

  const create = useApiMutation({
    key: 'purchases.create',
    fn: (body: CreatePurchaseInput) => purchasesService.create(body),
    invalidate: MONEY_KEYS,
    success: tr('purchases.toast.created'),
    onSuccess: (p) => {
      log.info('purchase created', { uuid: p.uuid, total: p.total_amount });
      router.replace(`/purchases/${p.uuid}`);
    },
  });
  const apiErrors = fieldErrors(create.error);
  const lineApiError = Object.entries(apiErrors).find(([k]) => k.startsWith('lines'))?.[1];

  const submit = () => {
    const next: Record<string, string> = {};
    if (!supplier) next.supplier = tr('purchases.validation.supplier');
    if (lines.length === 0) next.lines = tr('purchases.validation.lines');
    if (!account) next.account = tr('purchases.validation.finance_account');
    setErrors(next);
    if (Object.keys(next).length) return;
    create.mutate({
      supplier_uuid: supplier!.uuid,
      notes: notes.trim() || undefined,
      method,
      finance_account_uuid: account!,
      lines: lines.map((l) => ({ product_uuid: l.product_uuid, unit_cost: l.price || undefined, qty: l.qty || undefined })),
    });
  };

  if (accountsQuery.isError) {
    return (
      <Screen header={<Header title={tr('purchases.actions.create')} />}>
        <ErrorState error={accountsQuery.error} description={tr('finance.accounts.error_description')} onRetry={() => accountsQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title={tr('purchases.actions.create')} subtitle={tr('purchases.create.description')} />}
      footer={<Button size="lg" label={create.isPending ? tr('common.saving') : `${tr('common.save')} · ${fmt.money(total, currency)}`} loading={create.isPending} onPress={submit} />}
    >
      <SelectField
        label={tr('purchases.supplier')}
        placeholder={tr('purchases.pick_supplier')}
        value={supplier?.uuid ?? null}
        onChange={(v) => {
          setSupplier(supplierItems.find((s) => s.uuid === v) ?? null);
          setErrors((e) => ({ ...e, supplier: '' }));
        }}
        options={supplierItems.map((s) => ({ value: s.uuid, label: s.name, description: s.phone || undefined }))}
        onSearch={setSupplierQ}
        loading={suppliers.isFetching}
        error={errors.supplier || apiErrors.supplier_uuid}
        required
      />

      <Section title={tr('purchases.products')}>
        <ProductPicker
          mode="purchase"
          selected={lines.map((l) => l.product_uuid)}
          onAdd={(p) => {
            setLines((prev) => (prev.some((l) => l.product_uuid === p.uuid) ? prev : [...prev, draftFromProduct(p, 'purchase')]));
            setErrors((e) => ({ ...e, lines: '' }));
          }}
        />
        <DraftLines
          mode="purchase"
          lines={lines}
          onChange={(key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))}
          onRemove={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
        />
        {errors.lines || lineApiError ? (
          <Txt variant="caption" tone="danger">
            {errors.lines || lineApiError}
          </Txt>
        ) : null}
        <TotalRow label={tr('purchases.total')} value={fmt.money(total, currency)} />
      </Section>

      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('purchases.method')}
        </Txt>
        <Segmented<PurchaseMethod> value={method} onChange={setMethod} options={PURCHASE_METHODS.map((m) => ({ value: m, label: tr(`purchases.payment_method.${m}`) }))} />
      </View>
      <SelectField
        label={tr('purchases.finance_account')}
        placeholder={tr('purchases.pick_finance_account')}
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
      <TextField label={tr('purchases.notes')} value={notes} onChangeText={setNotes} multiline error={apiErrors.notes} />
    </Screen>
  );
}
