import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Minus, Plus, SlidersHorizontal, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DateField,
  EmptyState,
  ErrorState,
  FilterChips,
  Header,
  IconButton,
  ListSkeleton,
  Row,
  Screen,
  Segmented,
  Sheet,
  Txt,
  useConfirm,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { CariEntrySheet, type CariSheetKind } from '@/features/cari/components/cari-sheets';
import { cariService, type CariAccountDetail, type CariEntry } from '@/features/cari/services/cari.service';
import { MONEY_KEYS, useCariAccount, useCariEntriesInfinite } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.cari_detail');
const ENTRY_TYPES = ['charge', 'payment', 'adjustment', 'opening'] as const;
type TypeFilter = 'all' | (typeof ENTRY_TYPES)[number];
type StatusFilter = 'all' | 'posted' | 'void';
type Sort = '-entry_date' | 'entry_date';

export default function CariDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.cariRead} title={tr('cari.detail.title')}>
      <CariDetail />
    </RequirePermission>
  );
}

function CariDetail() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  // Web `useTenantCariAccess`: write = owner membership + cari.write.
  const canWrite = can({ perm: P.cariWrite, owner: true });
  const account = useCariAccount(id);
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('-entry_date');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheet, setSheet] = useState<CariSheetKind | null>(null);
  const entries = useCariEntriesInfinite(id, {
    sort,
    type: type === 'all' ? undefined : type,
    status: status === 'all' ? undefined : status,
    date_from: from ?? undefined,
    date_to: to ?? undefined,
  });
  const activeFilters = Number(status !== 'all') + Number(Boolean(from || to)) + Number(sort !== '-entry_date');

  const voidEntry = useApiMutation({
    key: 'cari.void',
    fn: (entryUuid: string) => cariService.voidEntry(entryUuid),
    invalidate: MONEY_KEYS,
    success: tr('cari.toast.void'),
    toastValidation: true,
    onSuccess: (e) => log.info('cari entry voided', { entry: e.uuid }),
  });

  const onVoid = async (entry: CariEntry) => {
    if (await confirm({ title: tr('cari.void.title'), message: tr('cari.void.description'), confirmLabel: tr('cari.void.confirm'), destructive: true })) voidEntry.mutate(entry.uuid);
  };

  if (account.isLoading) {
    return (
      <Screen header={<Header title={tr('cari.detail.title')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (account.isError || !account.data) {
    return (
      <Screen header={<Header title={tr('cari.detail.title')} />}>
        <ErrorState description={tr('cari.error_description')} onRetry={() => account.refetch()} />
      </Screen>
    );
  }
  const a = account.data;

  return (
    <Screen scroll={false} header={<Header title={a.customer_name} subtitle={a.customer_phone || a.customer_email || tr('cari.detail.description')} />}>
      <FlatList
        data={entries.items}
        keyExtractor={(e) => e.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <AccountHeader account={a} canWrite={canWrite} onAction={setSheet} />
            <Row gap={t.spacing.sm}>
              <Txt variant="heading" style={{ flex: 1 }}>
                {tr('cari.detail.entries')}
                {entries.total ? ` (${entries.total})` : ''}
              </Txt>
              <IconButton
                label={tr('mobile.commerce.filters')}
                icon={<SlidersHorizontal size={18} color={activeFilters ? t.colors.primary : t.colors.text} />}
                badge={activeFilters || undefined}
                onPress={() => setFiltersOpen(true)}
              />
            </Row>
            <FilterChips<TypeFilter>
              value={type}
              onChange={setType}
              options={[{ value: 'all', label: tr('mobile.common.all') }, ...ENTRY_TYPES.map((v) => ({ value: v, label: tr(`cari.entry_type.${v}`) }))]}
            />
          </View>
        }
        onEndReached={() => entries.hasNextPage && !entries.isFetchingNextPage && entries.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={(entries.isRefetching && !entries.isFetchingNextPage) || account.isRefetching}
            onRefresh={() => {
              account.refetch();
              entries.refetch();
            }}
            tintColor={t.colors.primary}
          />
        }
        ListFooterComponent={entries.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          entries.isLoading ? (
            <ListSkeleton rows={4} height={84} />
          ) : entries.isError ? (
            <ErrorState description={tr('cari.detail.entries_error')} onRetry={() => entries.refetch()} />
          ) : (
            <EmptyState title={tr('cari.detail.entries_empty')} description={tr('cari.detail.entries_empty_description')} />
          )
        }
        renderItem={({ item }) => <EntryCard entry={item} currency={a.currency} canVoid={canWrite} voiding={voidEntry.isPending && voidEntry.variables === item.uuid} onVoid={() => onVoid(item)} />}
      />

      {canWrite ? <CariEntrySheet accountUuid={a.uuid} kind={sheet} onClose={() => setSheet(null)} /> : null}

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={tr('mobile.commerce.filters')}
        footer={
          <Row gap={t.spacing.sm}>
            <Button
              style={{ flex: 1 }}
              variant="outline"
              label={tr('mobile.commerce.reset_filters')}
              onPress={() => {
                setStatus('all');
                setFrom(null);
                setTo(null);
                setSort('-entry_date');
              }}
            />
            <Button style={{ flex: 1 }} label={tr('mobile.common.done')} onPress={() => setFiltersOpen(false)} />
          </Row>
        }
      >
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('cari.entry_status')}
          </Txt>
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: tr('mobile.common.all') },
              { value: 'posted', label: tr('cari.status.posted') },
              { value: 'void', label: tr('cari.status.void') },
            ]}
          />
        </View>
        <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <DateField label={tr('mobile.commerce.date_from')} value={from} onChange={setFrom} allowClear maximumDate={to ? new Date(`${to}T12:00:00`) : undefined} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={tr('mobile.commerce.date_to')} value={to} onChange={setTo} allowClear minimumDate={from ? new Date(`${from}T12:00:00`) : undefined} />
          </View>
        </Row>
        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('mobile.commerce.sort')}
          </Txt>
          <Segmented<Sort>
            value={sort}
            onChange={setSort}
            options={[
              { value: '-entry_date', label: tr('mobile.commerce.sort_newest') },
              { value: 'entry_date', label: tr('mobile.commerce.sort_oldest') },
            ]}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function AccountHeader({ account: a, canWrite, onAction }: { account: CariAccountDetail; canWrite: boolean; onAction: (k: CariSheetKind) => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const balance = toNumber(a.balance);
  return (
    <View style={{ gap: t.spacing.md }}>
      <Row gap={t.spacing.sm} wrap>
        <Badge size="sm" tone={a.is_active ? 'success' : 'neutral'} label={a.is_active ? tr('common.active') : tr('common.passive')} />
        {a.customer_kind === 'company' && (a.customer_tax_id || a.customer_tax_office) ? (
          <Txt variant="caption" tone="secondary">
            {[a.customer_tax_id, a.customer_tax_office].filter(Boolean).join(' · ')}
          </Txt>
        ) : null}
      </Row>

      <Card style={{ gap: 4 }}>
        <Txt variant="caption" tone="secondary">
          {tr('cari.balance')}
        </Txt>
        <Txt variant="display" tone={balance > 0 ? 'warning' : 'default'} style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
          {fmt.money(a.balance, a.currency)}
        </Txt>
        {balance > 0 ? (
          <Txt variant="caption" tone="muted">
            {tr('cari.detail.receivable_hint')}
          </Txt>
        ) : null}
      </Card>

      {can(P.customersRead) ? <Button variant="ghost" size="sm" label={tr('cari.detail.view_customer')} onPress={() => router.push(`/customers/${a.customer_uuid}`)} style={{ alignSelf: 'flex-start' }} /> : null}

      {canWrite ? (
        <Row gap={t.spacing.sm}>
          <Button style={{ flex: 1 }} size="sm" variant="outline" label={tr('cari.actions.charge')} icon={<Plus size={16} color={t.colors.text} />} onPress={() => onAction('charge')} />
          <Button style={{ flex: 1 }} size="sm" label={tr('cari.actions.payment')} icon={<Wallet size={16} color={t.colors.onPrimary} />} onPress={() => onAction('payment')} />
          <Button style={{ flex: 1 }} size="sm" variant="outline" label={tr('cari.actions.adjustment')} icon={<Minus size={16} color={t.colors.text} />} onPress={() => onAction('adjustment')} />
        </Row>
      ) : null}
    </View>
  );
}

function EntryCard({ entry: e, currency, canVoid, voiding, onVoid }: { entry: CariEntry; currency: string; canVoid: boolean; voiding: boolean; onVoid: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const isVoid = e.status === 'void';
  return (
    <Card style={{ gap: 6 }}>
      <Row gap={t.spacing.sm}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong" numberOfLines={1} tone={isVoid ? 'muted' : 'default'}>
            {tr(`cari.entry_type.${e.type}`)}
          </Txt>
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt.date(`${e.entry_date}T12:00:00`)}
          </Txt>
        </View>
        <Badge size="sm" tone={isVoid ? 'neutral' : 'success'} label={tr(`cari.status.${e.status}`)} />
        {canVoid && e.status === 'posted' ? (
          voiding ? (
            <ActivityIndicator color={t.colors.danger} style={{ width: 44 }} />
          ) : (
            <IconButton variant="ghost" label={tr('cari.void.confirm')} icon={<Ban size={18} color={t.colors.danger} />} onPress={onVoid} />
          )
        ) : null}
      </Row>
      {e.description ? (
        <Txt variant="caption" tone="secondary" numberOfLines={3}>
          {e.description}
        </Txt>
      ) : null}
      {e.finance_account_name || e.payment_method ? (
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {[e.finance_account_name, e.payment_method ? tr(`cari.payment_method.${e.payment_method}`) : null].filter(Boolean).join(' · ')}
        </Txt>
      ) : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="mono" tone={isVoid ? 'muted' : e.type === 'payment' ? 'success' : 'default'} style={isVoid ? { textDecorationLine: 'line-through' } : undefined}>
          {fmt.money(e.amount, currency)}
        </Txt>
        <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {tr('cari.balance_after')}: {fmt.money(e.balance_after, currency)}
        </Txt>
      </Row>
    </Card>
  );
}
