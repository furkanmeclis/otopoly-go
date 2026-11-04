import { router } from 'expo-router';
import { ArrowUpRight, ChartColumn, ShoppingBag, SlidersHorizontal, Users, Wallet } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BarChart, EmptyState, ErrorState, FilterChips, Header, IconButton, KpiTile, Row, Screen, Section, Skeleton, Sparkline, Txt } from '@/components/ui';
import { isApiError, isFeatureDisabled } from '@/api/errors';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { financeMonthStart, financeToday } from '@/features/finance/lib';
import { defaultDraft, ReportFilterSheet, toQuery, type ReportDraft } from '@/features/reports/components/report-filters';
import { Legend, NamedTable, RankChart, ReportCard } from '@/features/reports/components/report-parts';
import { shiftDate } from '@/features/jobs/lib/job-ui';
import { useFinanceAccounts, useReportsOverview } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom';

export default function ReportsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.reportsRead} title={tr('reports.title')}>
      <Reports />
    </RequirePermission>
  );
}

function presetRange(p: Exclude<Preset, 'custom'>) {
  const today = financeToday();
  if (p === 'today') return { date_from: today, date_to: today };
  if (p === '7d') return { date_from: shiftDate(today, -6), date_to: today };
  if (p === '30d') return { date_from: shiftDate(today, -29), date_to: today };
  return { date_from: financeMonthStart(), date_to: today };
}

function Reports() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const [draft, setDraft] = useState<ReportDraft>(defaultDraft);
  const [sheetOpen, setSheetOpen] = useState(false);
  const applied = useMemo(() => toQuery(draft), [draft]);
  const overviewQuery = useReportsOverview(applied);
  const accounts = useFinanceAccounts(true);
  const overview = overviewQuery.data;
  const currency = overview?.filters.currency ?? 'TRY';
  const money = (v?: string) => fmt.money(v, currency);

  const preset: Preset = (['today', '7d', '30d', 'month'] as const).find((p) => {
    const r = presetRange(p);
    return r.date_from === draft.date_from && r.date_to === draft.date_to;
  }) ?? 'custom';

  const activeFilters = [draft.currency, draft.payment_method !== 'all' ? 1 : '', draft.source_type !== 'all' ? 1 : '', draft.account_uuid, draft.granularity !== 'day' ? 1 : ''].filter(Boolean).length;

  const methodLabel = (name: string) => {
    const key = `reports.method.${name}`;
    const l = tr(key);
    return l === key ? name : l;
  };
  const sourceLabel = (sourceType: string, type: string) => {
    const sk = sourceType ? `reports.source.${sourceType}` : 'reports.source.unknown';
    const s = tr(sk);
    const tk = `reports.type.${type}`;
    const ty = tr(tk);
    return `${s === sk ? sourceType || tr('reports.source.unknown') : s} · ${ty === tk ? type : ty}`;
  };

  const series = useMemo(() => overview?.timeseries ?? [], [overview?.timeseries]);
  const cashflow = useMemo(
    () =>
      series.map((p) => ({
        label: fmt.date(`${p.date}T12:00:00`, 'short'),
        title: fmt.date(`${p.date}T12:00:00`, 'long'),
        value: toNumber(p.income),
        secondary: toNumber(p.expense),
      })),
    [series, fmt],
  );
  const net = series.map((p) => toNumber(p.net));
  const featureLocked = overviewQuery.isError && isFeatureDisabled(overviewQuery.error);

  const k = overview?.kpis;
  const kpis = k
    ? [
        { label: tr('reports.kpis.income'), value: money(k.total_income), tone: 'success' as const },
        { label: tr('reports.kpis.expense'), value: money(k.total_expense), tone: 'danger' as const },
        { label: tr('reports.kpis.net'), value: money(k.net_profit), tone: toNumber(k.net_profit) >= 0 ? ('success' as const) : ('danger' as const) },
        { label: tr('reports.kpis.jobs_paid'), value: `${k.job_paid_count} · ${money(k.job_paid_total)}` },
        { label: tr('reports.kpis.avg_ticket'), value: money(k.avg_ticket) },
        { label: tr('reports.kpis.vehicles'), value: String(k.vehicles_served) },
        { label: tr('reports.kpis.sales'), value: `${k.sale_count} · ${money(k.sale_total)}` },
        { label: tr('reports.kpis.purchases'), value: `${k.purchase_count} · ${money(k.purchase_total)}` },
        { label: tr('reports.kpis.cari_charged'), value: money(k.cari_charged) },
        { label: tr('reports.kpis.cari_collected'), value: money(k.cari_collected) },
        { label: tr('reports.kpis.cari_outstanding'), value: money(k.cari_outstanding), tone: 'warning' as const },
        { label: tr('reports.kpis.cash'), value: money(k.cash_total) },
        { label: tr('reports.kpis.card'), value: money(k.card_total) },
        { label: tr('reports.kpis.cari_pay'), value: money(k.cari_payment_total) },
      ]
    : [];

  return (
    <Screen
      header={
        <Header
          title={tr('reports.title')}
          subtitle={tr('reports.subtitle')}
          right={<IconButton label={tr('reports.filters.title')} icon={<SlidersHorizontal size={18} color={t.colors.text} />} badge={activeFilters || undefined} onPress={() => setSheetOpen(true)} />}
        />
      }
      refreshing={overviewQuery.isRefetching}
      onRefresh={() => void overviewQuery.refetch()}
    >
      <View style={{ gap: t.spacing.sm }}>
        <FilterChips<Preset>
          value={preset}
          onChange={(p) => (p === 'custom' ? setSheetOpen(true) : setDraft((d) => ({ ...d, ...presetRange(p) })))}
          options={[
            { value: 'today', label: tr('reports.filters.preset_today') },
            { value: '7d', label: tr('reports.filters.preset_7d') },
            { value: '30d', label: tr('reports.filters.preset_30d') },
            { value: 'month', label: tr('reports.filters.preset_month') },
            { value: 'custom', label: tr('finance.summary.period') },
          ]}
        />
        <Pressable onPress={() => setSheetOpen(true)} accessibilityRole="button">
          <Txt variant="caption" tone="muted">
            {fmt.date(`${draft.date_from}T12:00:00`)} – {fmt.date(`${draft.date_to}T12:00:00`)} · {tr(`reports.filters.granularity_${draft.granularity}`)}
            {overviewQuery.isFetching && overview ? ' …' : ''}
          </Txt>
        </Pressable>
      </View>

      {featureLocked ? (
        <FeatureLockedState feature="module.reports" />
      ) : overviewQuery.isError ? (
        <ErrorState error={overviewQuery.error} description={isApiError(overviewQuery.error) ? overviewQuery.error.message : tr('reports.error')} onRetry={() => overviewQuery.refetch()} />
      ) : overviewQuery.isLoading && !overview ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={78} width="47%" radius={t.radius.lg} />
          ))}
        </View>
      ) : !overview ? (
        <EmptyState title={tr('reports.empty')} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
            {kpis.map((x) => (
              <KpiTile key={x.label} label={x.label} tone={x.tone} value={<Txt variant="heading" tone={x.tone ?? 'default'} numberOfLines={1} adjustsFontSizeToFit style={{ fontVariant: ['tabular-nums'] }}>{x.value}</Txt>} style={{ minWidth: '45%' }} />
            ))}
          </View>

          <Section title={tr('mobile.finance.reports_charts')}>
            <ReportCard title={tr('reports.charts.cashflow')} description={tr('reports.charts.cashflow_desc')} empty={!cashflow.some((c) => c.value || c.secondary)}>
              <Legend items={[{ color: t.colors.success, label: tr('reports.kpis.income') }, { color: t.colors.danger, label: tr('reports.kpis.expense') }]} />
              <BarChart
                data={cashflow}
                color={t.colors.success}
                secondary={t.colors.danger}
                height={160}
                formatValue={(n) => fmt.money(n, currency)}
                seriesLabels={{ primary: tr('reports.kpis.income'), secondary: tr('reports.kpis.expense') }}
              />
              <Legend items={[{ color: t.colors.info, label: tr('reports.kpis.net') }]} />
              <Sparkline
                values={net}
                height={40}
                color={t.colors.info}
                labels={cashflow.map((c) => c.title)}
                formatValue={(n) => fmt.money(n, currency)}
                seriesLabel={tr('reports.kpis.net')}
              />
            </ReportCard>
            <ReportCard title={tr('reports.charts.payments')} description={tr('reports.charts.payments_desc')} empty={!overview.payments_by_method.length}>
              <RankChart money={money} items={overview.payments_by_method.map((p) => ({ label: methodLabel(p.name), value: p.total }))} />
            </ReportCard>
            <ReportCard title={tr('reports.charts.services')} description={tr('reports.charts.services_desc')} empty={!overview.services.length}>
              <RankChart money={money} color={t.colors.chart[3]} items={overview.services.slice(0, 8).map((p) => ({ label: p.name, value: p.total }))} />
            </ReportCard>
            <ReportCard title={tr('reports.charts.products')} description={tr('reports.charts.products_desc')} empty={!overview.products.length}>
              <RankChart money={money} color={t.colors.chart[4]} items={overview.products.slice(0, 8).map((p) => ({ label: p.name, value: p.total }))} />
            </ReportCard>
            <ReportCard title={tr('reports.charts.expenses')} empty={!overview.expenses_by_category.length}>
              <RankChart money={money} items={overview.expenses_by_category.map((p) => ({ label: p.name, value: p.total }))} />
            </ReportCard>
            <ReportCard title={tr('reports.charts.sources')} empty={!overview.revenue_by_source.length}>
              <RankChart money={money} color={t.colors.chart[2]} items={overview.revenue_by_source.map((r) => ({ label: sourceLabel(r.source_type, r.type), value: r.total }))} />
            </ReportCard>
          </Section>

          <NamedTable title={tr('reports.tables.services')} icon={<ChartColumn size={16} color={t.colors.textSecondary} />} rows={overview.services} money={money} />
          <NamedTable title={tr('reports.tables.products')} icon={<ShoppingBag size={16} color={t.colors.textSecondary} />} rows={overview.products} money={money} showQty />
          <NamedTable title={tr('reports.tables.expenses')} icon={<ArrowUpRight size={16} color={t.colors.textSecondary} />} rows={overview.expenses_by_category} money={money} />

          <ReportCard title={tr('reports.tables.cari')} icon={<Wallet size={16} color={t.colors.textSecondary} />} empty={!overview.cari_receivables.length}>
            {overview.cari_receivables.map((r, i) => (
              <Row key={r.account_uuid} style={{ paddingVertical: t.spacing.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.border }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {r.customer_name}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {r.customer_phone || '—'} · {tr('reports.tables.last_entry')}: {r.last_entry_date ? fmt.date(r.last_entry_date.slice(0, 10)) : '—'}
                  </Txt>
                </View>
                <Txt variant="mono" tone="warning">
                  {fmt.money(r.balance, r.currency)}
                </Txt>
              </Row>
            ))}
          </ReportCard>

          <ReportCard title={tr('reports.tables.customers')} icon={<Users size={16} color={t.colors.textSecondary} />} empty={!overview.top_customers.length}>
            {overview.top_customers.map((r, i) => (
              <Pressable key={r.customer_uuid} onPress={() => router.push(`/customers/${r.customer_uuid}`)} accessibilityRole="button" accessibilityLabel={r.customer_name}>
                <Row style={{ paddingVertical: t.spacing.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.border }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>
                      {r.customer_name}
                    </Txt>
                    <Txt variant="caption" tone="secondary">
                      {tr('reports.tables.count')}: {r.job_count}
                    </Txt>
                  </View>
                  <Txt variant="mono">{money(r.job_total)}</Txt>
                </Row>
              </Pressable>
            ))}
          </ReportCard>

          <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {tr('mobile.finance.generated_at', { time: fmt.dateTime(overview.generated_at) })}
          </Txt>
        </>
      )}

      <ReportFilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        value={draft}
        onApply={(d) => {
          setDraft(d);
          setSheetOpen(false);
        }}
        accounts={(accounts.data?.items ?? []).map((a) => ({ value: a.uuid, label: a.name }))}
      />
    </Screen>
  );
}
