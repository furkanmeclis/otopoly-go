import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Banknote, Landmark, Layers, Plus, Receipt, ScrollText } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Amount,
  Button,
  Card,
  DateField,
  EmptyState,
  ErrorState,
  Group,
  Header,
  KpiTile,
  ListRow,
  ListSkeleton,
  RankBars,
  Row,
  Screen,
  Section,
  Segmented,
  Txt,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { AccountSheet } from '@/features/finance/components/account-sheet';
import { accountTypeKey, TransactionRow } from '@/features/finance/components/finance-parts';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { businessMonthStart } from '@/lib/business-date';
import { qk, useFinanceSummary, useTransactionsInfinite } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

type Preset = 'month' | '7d' | '30d' | 'custom';

const monthStart = () => businessMonthStart();

export default function FinanceScreen() {
  useLiveResource(['tenant.finance.transactions', 'tenant.finance.accounts', 'tenant.cari']);
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.title')}>
      <FinanceSummary />
    </RequirePermission>
  );
}

function FinanceSummary() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const [accountOpen, setAccountOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>('month');
  const [range, setRange] = useState({ date_from: monthStart(), date_to: localToday() });
  const summary = useFinanceSummary(range);
  const recent = useTransactionsInfinite({ date_from: range.date_from, date_to: range.date_to, sort: '-transaction_date,-created_at' });
  const s = summary.data;
  const net = toNumber(s?.net);
  const totalCash = (s?.accounts ?? []).reduce((sum, a) => sum + toNumber(a.current_balance), 0);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const today = localToday();
    if (p === 'month') setRange({ date_from: monthStart(), date_to: today });
    if (p === '7d') setRange({ date_from: shiftDate(today, -6), date_to: today });
    if (p === '30d') setRange({ date_from: shiftDate(today, -29), date_to: today });
  };

  return (
    <Screen
      header={<Header back={false} title={tr('finance.title')} subtitle={tr('finance.subtitle')} />}
      refreshing={summary.isRefetching}
      onRefresh={() => qc.invalidateQueries({ queryKey: qk.finance })}
    >
      {canWrite ? (
        <Row gap={t.spacing.sm}>
          <Button style={{ flex: 1 }} size="sm" variant="outline" label={tr('finance.actions.add_income')} icon={<ArrowDownLeft size={16} color={t.colors.success} />} onPress={() => router.push({ pathname: '/finance/transactions/new', params: { type: 'income' } })} />
          <Button style={{ flex: 1 }} size="sm" variant="outline" label={tr('finance.actions.add_expense')} icon={<ArrowUpRight size={16} color={t.colors.danger} />} onPress={() => router.push({ pathname: '/finance/transactions/new', params: { type: 'expense' } })} />
          <Button size="sm" label={tr('finance.actions.transfer')} icon={<ArrowRightLeft size={16} color={t.colors.onPrimary} />} onPress={() => router.push('/finance/transfer')} />
        </Row>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <Segmented<Preset>
          value={preset}
          onChange={applyPreset}
          options={[
            { value: 'month', label: tr('finance.summary.reset_filter') },
            { value: '7d', label: tr('mobile.finance.last_7') },
            { value: '30d', label: tr('mobile.finance.last_30') },
            { value: 'custom', label: tr('finance.summary.period') },
          ]}
        />
        {preset === 'custom' ? (
          <Row gap={t.spacing.sm}>
            <View style={{ flex: 1 }}>
              <DateField label={tr('finance.summary.date_from')} value={range.date_from} onChange={(v) => v && setRange((r) => ({ ...r, date_from: v }))} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label={tr('finance.summary.date_to')} value={range.date_to} onChange={(v) => v && setRange((r) => ({ ...r, date_to: v }))} />
            </View>
          </Row>
        ) : null}
        {s ? (
          <Txt variant="caption" tone="muted">
            {tr('finance.summary.period_label', { from: fmt.date(`${s.date_from}T12:00:00`), to: fmt.date(`${s.date_to}T12:00:00`) })}
          </Txt>
        ) : null}
      </View>

      {summary.isError ? (
        <ErrorState error={summary.error} description={tr('finance.summary.error_description')} onRetry={() => summary.refetch()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
            <KpiTile tone="success" icon={<ArrowDownLeft size={16} color={t.colors.success} />} label={tr('finance.summary.income')} value={summary.isLoading ? '…' : <Amount value={s?.total_income} variant="title" />} />
            <KpiTile tone="danger" icon={<ArrowUpRight size={16} color={t.colors.danger} />} label={tr('finance.summary.expense')} value={summary.isLoading ? '…' : <Amount value={s?.total_expense} variant="title" />} />
            <KpiTile tone={net >= 0 ? 'success' : 'danger'} label={tr('finance.summary.net')} value={summary.isLoading ? '…' : <Amount value={net} variant="title" signed />} />
            <KpiTile tone="primary" icon={<Banknote size={16} color={t.colors.primary} />} label={tr('finance.summary.total_cash')} value={summary.isLoading ? '…' : <Amount value={totalCash} variant="title" />} />
          </View>

          {s && toNumber(s.total_income) + toNumber(s.total_expense) > 0 ? (
            <Card style={{ gap: t.spacing.sm }}>
              <Txt variant="bodyStrong">{tr('finance.summary.flow_mix')}</Txt>
              <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken }}>
                <View style={{ flex: toNumber(s.total_income), backgroundColor: t.colors.success }} />
                <View style={{ flex: toNumber(s.total_expense), backgroundColor: t.colors.danger }} />
              </View>
              <Txt variant="caption" tone="secondary">
                {tr('finance.summary.expense_share')}: {fmt.percent(toNumber(s.total_expense) / Math.max(1, toNumber(s.total_income)))}
              </Txt>
            </Card>
          ) : null}

          <Section title={tr('finance.summary.accounts')} action={{ label: tr('finance.summary.view_accounts'), onPress: () => router.push('/finance/accounts') }}>
            <Group>
              {summary.isLoading ? (
                <View style={{ padding: t.spacing.lg }}>
                  <ListSkeleton rows={2} height={40} />
                </View>
              ) : (s?.accounts ?? []).length === 0 ? (
                <EmptyState
                  title={tr('finance.summary.no_accounts')}
                  description={tr('finance.summary.no_accounts_description')}
                  action={
                    canWrite ? (
                      <Button size="sm" label={tr('finance.accounts.create')} icon={<Plus size={16} color={t.colors.onPrimary} />} onPress={() => setAccountOpen(true)} />
                    ) : undefined
                  }
                />
              ) : (
                (s?.accounts ?? []).map((a, i, arr) => (
                  <ListRow
                    key={a.uuid}
                    title={a.name}
                    subtitle={`${tr(accountTypeKey(a.type))}${a.is_default ? ` · ${tr('finance.accounts.default')}` : ''}`}
                    left={a.type === 'bank' ? <Landmark size={20} color={t.colors.info} /> : <Banknote size={20} color={t.colors.success} />}
                    right={<Amount value={a.current_balance} currency={a.currency} tone={toNumber(a.current_balance) < 0 ? 'danger' : 'default'} />}
                    onPress={() => router.push(`/finance/accounts/${a.uuid}`)}
                    chevron={false}
                    last={i === arr.length - 1}
                  />
                ))
              )}
            </Group>
          </Section>

          <Section title={tr('finance.summary.expense_breakdown')} action={{ label: tr('finance.summary.manage_categories'), onPress: () => router.push('/finance/categories') }}>
            <Card>
              {(s?.expense_by_category ?? []).length === 0 ? (
                <Txt tone="secondary" variant="caption">
                  {tr('finance.summary.expense_breakdown_empty')}
                </Txt>
              ) : (
                <RankBars items={(s?.expense_by_category ?? []).slice(0, 6).map((c) => ({ label: c.category_name, value: toNumber(c.total), display: fmt.moneyCompact(c.total) }))} />
              )}
            </Card>
          </Section>

          <Section title={tr('finance.summary.recent_transactions')} action={{ label: tr('finance.summary.view_transactions'), onPress: () => router.push('/finance/transactions') }}>
            <Group>
              {recent.isLoading ? (
                <View style={{ padding: t.spacing.lg }}>
                  <ListSkeleton rows={3} height={40} />
                </View>
              ) : recent.items.length === 0 ? (
                <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
                  {tr('finance.summary.recent_transactions_empty')}
                </Txt>
              ) : (
                recent.items.slice(0, 8).map((txn, i, arr) => <TransactionRow key={txn.uuid} txn={txn} last={i === arr.length - 1} />)
              )}
            </Group>
          </Section>

          <Section title={tr('finance.quick_links.title')}>
            <Group>
              <ListRow title={tr('layout.nav_finance_accounts')} subtitle={tr('finance.quick_links.accounts')} left={<Landmark size={20} color={t.colors.primary} />} onPress={() => router.push('/finance/accounts')} />
              <ListRow title={tr('layout.nav_finance_transactions')} subtitle={tr('finance.quick_links.transactions')} left={<ScrollText size={20} color={t.colors.primary} />} onPress={() => router.push('/finance/transactions')} />
              <ListRow title={tr('layout.nav_finance_categories')} subtitle={tr('finance.quick_links.categories')} left={<Layers size={20} color={t.colors.primary} />} onPress={() => router.push('/finance/categories')} />
              {can(P.cariRead) ? <ListRow title={tr('layout.nav_cari')} subtitle={tr('cari.description')} left={<Receipt size={20} color={t.colors.primary} />} onPress={() => router.push('/cari')} /> : null}
              {canWrite ? <ListRow title={tr('finance.actions.transfer')} subtitle={tr('finance.quick_links.transfer')} left={<ArrowRightLeft size={20} color={t.colors.primary} />} onPress={() => router.push('/finance/transfer')} last /> : null}
            </Group>
          </Section>
        </>
      )}
      {canWrite ? <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} /> : null}
    </Screen>
  );
}
