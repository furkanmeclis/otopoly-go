import { router } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, ScrollText, SlidersHorizontal, X } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, DateField, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, SearchBar, SelectField, Sheet, TextField, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { TransactionRow } from '@/features/finance/components/finance-parts';
import { TX_TYPES } from '@/features/finance/lib';
import { useAllFinanceCategories } from '@/features/finance/queries';
import { useFinanceAccounts, useTransactionsInfinite } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

type TypeFilter = 'all' | (typeof TX_TYPES)[number];
type SortKey = '-transaction_date' | 'transaction_date' | '-amount' | 'amount' | 'type';

type Filters = {
  status: '' | 'posted' | 'void';
  account_uuid: string;
  category_uuid: string;
  date_from: string;
  date_to: string;
  currency: string;
  sort: SortKey;
};

const EMPTY: Filters = { status: '', account_uuid: '', category_uuid: '', date_from: '', date_to: '', currency: '', sort: '-transaction_date' };

export default function FinanceTransactionsScreen() {
  useLiveResource('tenant.finance.transactions');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.transactions.title')}>
      <TransactionsList />
    </RequirePermission>
  );
}

function TransactionsList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sheetOpen, setSheetOpen] = useState(false);
  const query = useDeferredValue(q.trim());

  // Filter option sources (web: active accounts + all categories).
  const accounts = useFinanceAccounts(true);
  const accountItems = accounts.data?.items ?? [];
  const categories = useAllFinanceCategories();
  const accountName = accountItems.find((a) => a.uuid === filters.account_uuid)?.name;
  const categoryName = categories.data?.items.find((c) => c.uuid === filters.category_uuid)?.name;

  const list = useTransactionsInfinite({
    q: query || undefined,
    type: type === 'all' ? undefined : type,
    status: filters.status || undefined,
    account_uuid: filters.account_uuid || undefined,
    category_uuid: filters.category_uuid || undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    currency: filters.currency.trim().toUpperCase() || undefined,
    sort: filters.sort === '-transaction_date' ? '-transaction_date,-created_at' : filters.sort,
  });

  const active = useMemo(() => {
    const chips: { key: keyof Filters; label: string }[] = [];
    if (filters.status) chips.push({ key: 'status', label: tr(filters.status === 'void' ? 'finance.transactions.status_void' : 'finance.transactions.status_posted') });
    if (filters.account_uuid) chips.push({ key: 'account_uuid', label: accountName ?? tr('finance.transactions.account') });
    if (filters.category_uuid) chips.push({ key: 'category_uuid', label: categoryName ?? tr('finance.transactions.category') });
    if (filters.date_from) chips.push({ key: 'date_from', label: `${tr('finance.transactions.date_from')}: ${fmt.date(`${filters.date_from}T12:00:00`)}` });
    if (filters.date_to) chips.push({ key: 'date_to', label: `${tr('finance.transactions.date_to')}: ${fmt.date(`${filters.date_to}T12:00:00`)}` });
    if (filters.currency.trim()) chips.push({ key: 'currency', label: filters.currency.trim().toUpperCase() });
    return chips;
  }, [filters, accountName, categoryName, tr, fmt]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('finance.transactions.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('finance.transactions.subtitle')}
        right={
          <IconButton
            label={tr('finance.transactions.filters_title')}
            icon={<SlidersHorizontal size={18} color={t.colors.text} />}
            badge={active.length || undefined}
            onPress={() => setSheetOpen(true)}
          />
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(x) => x.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.md }}>
            {canWrite ? (
              <Row gap={t.spacing.sm}>
                <Button
                  style={{ flex: 1 }}
                  size="sm"
                  variant="outline"
                  label={tr('finance.actions.add_income')}
                  icon={<ArrowDownLeft size={16} color={t.colors.success} />}
                  onPress={() => router.push({ pathname: '/finance/transactions/new', params: { type: 'income' } })}
                />
                <Button
                  style={{ flex: 1 }}
                  size="sm"
                  variant="outline"
                  label={tr('finance.actions.add_expense')}
                  icon={<ArrowUpRight size={16} color={t.colors.danger} />}
                  onPress={() => router.push({ pathname: '/finance/transactions/new', params: { type: 'expense' } })}
                />
              </Row>
            ) : null}
            <SearchBar value={q} onChangeText={setQ} placeholder={`${tr('finance.transactions.description')}, ${tr('finance.detail.reference_no')}`} />
            <FilterChips<TypeFilter>
              value={type}
              onChange={setType}
              options={[{ value: 'all', label: tr('mobile.common.all') }, ...TX_TYPES.map((v) => ({ value: v, label: tr(`finance.transactions.type_${v}`) }))]}
            />
            {active.length ? (
              <Row gap={t.spacing.sm} wrap>
                {active.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => setFilters((f) => ({ ...f, [c.key]: '' }))}
                    accessibilityRole="button"
                    accessibilityLabel={`${tr('common.clear')} ${c.label}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: t.radius.full,
                      backgroundColor: t.colors.primarySoft,
                    }}
                  >
                    <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
                      {c.label}
                    </Txt>
                    <X size={12} color={t.colors.primary} />
                  </Pressable>
                ))}
                <Pressable onPress={() => setFilters(EMPTY)} hitSlop={8} accessibilityRole="button">
                  <Txt variant="caption" tone="secondary" style={{ fontWeight: '700', paddingVertical: 5 }}>
                    {tr('mobile.finance.clear_filters')}
                  </Txt>
                </Pressable>
              </Row>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const last = index === list.items.length - 1;
          return (
            <View
              style={{
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderTopWidth: index === 0 ? 1 : 0,
                borderBottomWidth: last ? 1 : 0,
                borderTopLeftRadius: index === 0 ? t.radius.lg : 0,
                borderTopRightRadius: index === 0 ? t.radius.lg : 0,
                borderBottomLeftRadius: last ? t.radius.lg : 0,
                borderBottomRightRadius: last ? t.radius.lg : 0,
                overflow: 'hidden',
              }}
            >
              <TransactionRow txn={item} perspective={filters.account_uuid || undefined} last={last} />
            </View>
          );
        }}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={56} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('finance.transactions.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<ScrollText size={28} color={t.colors.textMuted} />}
              title={tr('finance.transactions.empty')}
              description={q || active.length || type !== 'all' ? tr('finance.detail.ledger_empty') : tr('finance.transactions.empty_description')}
            />
          )
        }
      />
      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        value={filters}
        onApply={(f) => {
          setFilters(f);
          setSheetOpen(false);
        }}
        accountOptions={accountItems.map((a) => ({ value: a.uuid, label: a.name, description: a.currency }))}
        categoryOptions={(categories.data?.items ?? []).map((c) => ({ value: c.uuid, label: c.name, description: tr(c.kind === 'income' ? 'finance.categories.kind_income' : 'finance.categories.kind_expense') }))}
      />
    </SafeAreaView>
  );
}

function FilterSheet({
  visible,
  onClose,
  value,
  onApply,
  accountOptions,
  categoryOptions,
}: {
  visible: boolean;
  onClose: () => void;
  value: Filters;
  onApply: (f: Filters) => void;
  accountOptions: { value: string; label: string; description?: string }[];
  categoryOptions: { value: string; label: string; description?: string }[];
}) {
  if (!visible) return null;
  return <FilterSheetContent onClose={onClose} value={value} onApply={onApply} accountOptions={accountOptions} categoryOptions={categoryOptions} />;
}

function FilterSheetContent({
  onClose,
  value,
  onApply,
  accountOptions,
  categoryOptions,
}: {
  onClose: () => void;
  value: Filters;
  onApply: (f: Filters) => void;
  accountOptions: { value: string; label: string; description?: string }[];
  categoryOptions: { value: string; label: string; description?: string }[];
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [draft, setDraft] = useState<Filters>(value);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const rangeError = draft.date_from && draft.date_to && draft.date_from > draft.date_to ? tr('mobile.finance.date_range_invalid') : null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={tr('finance.transactions.filters_title')}
      footer={
        <Row gap={t.spacing.sm}>
          <Button style={{ flex: 1 }} variant="outline" label={tr('mobile.finance.clear_filters')} onPress={() => onApply(EMPTY)} />
          <Button style={{ flex: 1 }} label={tr('finance.summary.apply_filter')} disabled={Boolean(rangeError)} onPress={() => onApply(draft)} />
        </Row>
      }
    >
      <Txt variant="caption" tone="secondary">
        {tr('finance.transactions.filters_description')}
      </Txt>
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('finance.transactions.status')}
        </Txt>
        <FilterChips<'all' | 'posted' | 'void'>
          value={draft.status || 'all'}
          onChange={(v) => set('status', v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: tr('mobile.finance.any_status') },
            { value: 'posted', label: tr('finance.transactions.status_posted') },
            { value: 'void', label: tr('finance.transactions.status_void') },
          ]}
        />
      </View>
      <SelectField label={tr('finance.transactions.account')} value={draft.account_uuid || null} options={accountOptions} onChange={(v) => set('account_uuid', v ?? '')} placeholder={tr('reports.filters.account_all')} allowClear searchable />
      <SelectField label={tr('finance.transactions.category')} value={draft.category_uuid || null} options={categoryOptions} onChange={(v) => set('category_uuid', v ?? '')} placeholder={tr('mobile.common.all')} allowClear searchable />
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('finance.transactions.date_from')} value={draft.date_from || null} onChange={(v) => set('date_from', v ?? '')} allowClear error={rangeError} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label={tr('finance.transactions.date_to')} value={draft.date_to || null} onChange={(v) => set('date_to', v ?? '')} allowClear />
        </View>
      </Row>
      <TextField label={tr('finance.transactions.currency')} value={draft.currency} onChangeText={(v) => set('currency', v.toUpperCase())} maxLength={3} autoCapitalize="characters" placeholder="TRY" />
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('mobile.finance.sort')}
        </Txt>
        <FilterChips<SortKey>
          value={draft.sort}
          onChange={(v) => set('sort', v)}
          options={[
            { value: '-transaction_date', label: tr('mobile.finance.sort_newest') },
            { value: 'transaction_date', label: tr('mobile.finance.sort_oldest') },
            { value: '-amount', label: tr('mobile.finance.sort_amount_desc') },
            { value: 'amount', label: tr('mobile.finance.sort_amount_asc') },
            { value: 'type', label: tr('finance.transactions.type') },
          ]}
        />
      </View>
      <Txt variant="caption" tone="muted">
        {tr('finance.transactions.search_hint')}
      </Txt>
    </Sheet>
  );
}
