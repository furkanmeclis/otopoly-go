import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import {
  AlarmClock,
  CarFront,
  FileText,
  KeyRound,
  Plus,
  ShoppingBag,
  UserPlus,
  Wallet,
  Wrench,
} from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { BrandMark } from '@/components/brand';
import {
  Avatar,
  BarChart,
  Button,
  Card,
  Group,
  ListRow,
  PlateBadge,
  RankBars,
  Row,
  Screen,
  Section,
  Skeleton,
  Txt,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { JobElapsed, useNow } from '@/features/jobs/components/job-parts';
import { isStale, localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import {
  useJobs,
  useJobsSummary,
  useLeadsSummary,
  useQuotesSummary,
  useReportsOverview,
  useTodos,
} from '@/features/queries';
import { TodoRow } from '@/features/todos/components/todo-row';
import { NotificationBell } from '@/features/notifications/components/notification-parts';
import { SetupChecklist } from '@/features/onboarding/components/setup-checklist';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';

const CHART_DAYS = 30;

function greetingKey(hour: number) {
  if (hour < 12) return 'dashboard.tenant.greeting_morning';
  if (hour < 18) return 'dashboard.tenant.greeting_day';
  return 'dashboard.tenant.greeting_evening';
}

export default function DashboardScreen() {
  useMarkInteractive();
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { me, organization, can } = useAuth();
  const firstName = me?.user.name ?? '';
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const queryRefresh = useRefreshAll();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryRefresh();
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, [queryRefresh]);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ gap: 4, paddingTop: t.spacing.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="caption" tone="secondary">
            {fmt.date(new Date(), 'long')}
          </Txt>
          <Row gap={t.spacing.sm}>
            <BrandMark height={22} />
            <NotificationBell />
          </Row>
        </Row>
        <Txt variant="display" numberOfLines={2}>
          {firstName ? tr(greetingKey(new Date().getHours()), { name: firstName }) : (organization?.name ?? '')}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {tr('dashboard.tenant.subtitle', { org: organization?.name ?? '' })}
        </Txt>
      </View>

      <Row gap={t.spacing.sm} wrap>
        {can(P.jobsWrite) ? (
          <Button size="sm" label={tr('jobs.actions.create')} icon={<Plus size={16} color={t.colors.onPrimary} />} onPress={() => router.push('/jobs/new')} />
        ) : null}
        {can(P.salesWrite) ? (
          <Button size="sm" variant="outline" label={tr('sales.quick.title')} icon={<ShoppingBag size={16} color={t.colors.text} />} onPress={() => router.push('/sales/new')} />
        ) : null}
        {can(P.customersRead) ? (
          <Button size="sm" variant="outline" label={tr('dashboard.tenant.customers')} icon={<UserPlus size={16} color={t.colors.text} />} onPress={() => router.push('/customers')} />
        ) : null}
      </Row>

      <SetupChecklist key={`setup-${refreshKey}`} />
      {can(P.jobsRead) ? <TodaySection /> : null}
      <PipelineSection />
      {can(P.todosRead) ? <TodosWidget /> : null}
      {can(P.reportsRead) ? <InsightsSection /> : null}
    </Screen>
  );
}

function useRefreshAll() {
  const qc = useQueryClient();
  return useCallback(() => qc.refetchQueries({ type: 'active' }), [qc]);
}

// ─── Today ─────────────────────────────────────────────────────────────────

function TodaySection() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const today = localToday();
  const now = useNow();
  const jobsQuery = useJobs({ limit: 100, offset: 0, sort: '-started_at', date_from: today, date_to: today, include_open: 'true' });
  const summary = useJobsSummary(today);
  const jobs = jobsQuery.data?.items ?? [];
  const inProgress = jobs.filter((j) => j.status === 'in_progress');
  const ready = jobs.filter((j) => j.status === 'ready');
  const delivered = jobs.filter((j) => j.status === 'delivered' && (j.delivered_at ?? '').slice(0, 10) >= shiftDate(today, -1));
  const unpaidDelivered = delivered.filter((j) => j.payment_status === 'unpaid');
  const stale = inProgress.filter((j) => isStale(j, now));
  const queue = [...ready, ...inProgress].slice(0, 6);
  const loading = jobsQuery.isLoading || summary.isLoading;

  const tiles: { icon: ReactNode; label: string; value: string; hint?: string; warn?: boolean; bg: string }[] = [
    {
      icon: <Wrench size={18} color={t.colors.warning} />,
      bg: t.colors.warningBg,
      label: tr('jobs.status.in_progress'),
      value: String(inProgress.length),
      hint: stale.length ? tr('dashboard.tenant.stale', { count: stale.length }) : undefined,
      warn: stale.length > 0,
    },
    {
      icon: <KeyRound size={18} color={t.colors.info} />,
      bg: t.colors.infoBg,
      label: tr('jobs.status.ready'),
      value: String(ready.length),
      hint: ready.length ? tr('dashboard.tenant.ready_hint') : undefined,
    },
    {
      icon: <CarFront size={18} color={t.colors.success} />,
      bg: t.colors.successBg,
      label: tr('dashboard.tenant.delivered_today'),
      value: String(delivered.length),
      hint: unpaidDelivered.length ? tr('dashboard.tenant.unpaid', { count: unpaidDelivered.length }) : undefined,
      warn: unpaidDelivered.length > 0,
    },
    {
      icon: <Wallet size={18} color={t.colors.primary} />,
      bg: t.colors.primarySoft,
      label: tr('dashboard.tenant.collected_today'),
      value: fmt.money(summary.data?.paid_total),
      hint: tr('dashboard.tenant.card_cari', { card: fmt.moneyCompact(summary.data?.card_total), cari: fmt.moneyCompact(summary.data?.cari_total) }),
    },
  ];

  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
        {tiles.map((tile) => (
          <Card key={tile.label} onPress={() => router.push('/operations')} style={{ width: '47.5%', flexGrow: 1, gap: 6 }} accessibilityLabel={`${tile.label}: ${tile.value}`}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tile.bg, alignItems: 'center', justifyContent: 'center' }}>{tile.icon}</View>
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {tile.label}
            </Txt>
            {loading ? (
              <Skeleton height={26} width={80} />
            ) : (
              <Txt variant="title" numberOfLines={1} adjustsFontSizeToFit style={{ fontVariant: ['tabular-nums'] }}>
                {tile.value}
              </Txt>
            )}
            {tile.hint ? (
              <Txt variant="caption" tone={tile.warn ? 'warning' : 'muted'} numberOfLines={1} style={{ fontWeight: tile.warn ? '700' : '400' }}>
                {tile.hint}
              </Txt>
            ) : null}
          </Card>
        ))}
      </View>

      <Section title={tr('dashboard.tenant.queue')} action={{ label: tr('dashboard.tenant.open_board'), onPress: () => router.push('/operations') }}>
        <Group>
          {loading ? (
            <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={36} />
              ))}
            </View>
          ) : queue.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.xl, textAlign: 'center' }}>
              {tr('dashboard.tenant.queue_empty')}
            </Txt>
          ) : (
            queue.map((job, i) => (
              <ListRow
                key={job.uuid}
                title={job.customer_name}
                subtitle={job.vehicle_label}
                left={<PlateBadge plate={job.plate} size="sm" />}
                right={
                  job.status === 'ready' ? (
                    <Txt variant="caption" tone="info" style={{ fontWeight: '700' }}>
                      {tr('jobs.status.ready')}
                    </Txt>
                  ) : (
                    <JobElapsed startedAt={job.started_at} now={now} stale={isStale(job, now)} />
                  )
                }
                onPress={() => router.push(`/jobs/${job.uuid}`)}
                chevron={false}
                last={i === queue.length - 1}
              />
            ))
          )}
        </Group>
      </Section>
    </View>
  );
}

// ─── Pipeline (leads + quotes) ─────────────────────────────────────────────

function PipelineSection() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const canLeads = can(P.leadsRead);
  const canQuotes = can(P.quotesRead);
  const leads = useLeadsSummary(canLeads);
  const quotes = useQuotesSummary(canQuotes);
  if (!canLeads && !canQuotes) return null;
  // The plan turns the quotes & leads module off: no pipeline (same as insights without reports).
  if (isFeatureDisabled(leads.error) || isFeatureDisabled(quotes.error)) return null;

  const tiles = [
    canLeads
      ? {
          key: 'leads',
          href: '/leads' as Href,
          icon: <AlarmClock size={20} color={t.colors.primary} />,
          label: tr('dashboard.pipeline.follow_up'),
          value: String((leads.data?.overdue ?? 0) + (leads.data?.due_today ?? 0)),
          hint: leads.data?.overdue ? tr('dashboard.pipeline.overdue', { count: leads.data.overdue }) : tr('dashboard.pipeline.open_leads', { count: leads.data?.open ?? 0 }),
          danger: (leads.data?.overdue ?? 0) > 0,
          loading: leads.isLoading,
        }
      : null,
    canQuotes
      ? {
          key: 'quotes',
          href: '/quotes' as Href,
          icon: <FileText size={20} color={t.colors.primary} />,
          label: tr('dashboard.pipeline.open_quotes'),
          value: fmt.money(quotes.data?.pending_total ?? '0', quotes.data?.currency ?? 'TRY'),
          hint: quotes.data?.expiring_soon ? tr('dashboard.pipeline.expiring', { count: quotes.data.expiring_soon }) : tr('dashboard.pipeline.awaiting', { count: quotes.data?.awaiting_count ?? 0 }),
          danger: false,
          loading: quotes.isLoading,
        }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <View style={{ gap: t.spacing.md }}>
      {tiles.map((tile) => (
        <Card key={tile.key} onPress={() => router.push(tile.href)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }} accessibilityLabel={tile.label}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>{tile.icon}</View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="caption" tone="secondary">
              {tile.label}
            </Txt>
            {tile.loading ? <Skeleton height={22} width={90} /> : <Txt variant="heading" style={{ fontVariant: ['tabular-nums'] }}>{tile.value}</Txt>}
            <Txt variant="caption" tone={tile.danger ? 'danger' : 'muted'} numberOfLines={1}>
              {tile.hint}
            </Txt>
          </View>
        </Card>
      ))}
    </View>
  );
}

// ─── Todos widget ──────────────────────────────────────────────────────────

function TodosWidget() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const list = useTodos({ status: 'open', scope: 'open_due', limit: 8 });
  const items = list.data?.items ?? [];
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <Section title={tr('todos.widget.title')} action={{ label: tr('todos.widget.all'), onPress: () => router.push('/todos') }}>
      {overdue ? (
        <Txt variant="caption" tone="danger" style={{ fontWeight: '700', marginTop: -4 }}>
          {tr('todos.widget.overdue', { count: overdue })}
        </Txt>
      ) : null}
      <Group>
        {list.isLoading ? (
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            <Skeleton height={36} />
            <Skeleton height={36} />
          </View>
        ) : items.length === 0 ? (
          <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.xl, textAlign: 'center' }}>
            {tr('todos.widget.empty')}
          </Txt>
        ) : (
          items.map((todo, i) => <TodoRow key={todo.uuid} todo={todo} canWrite={can(P.todosWrite)} onPress={() => router.push('/todos')} last={i === items.length - 1} />)
        )}
      </Group>
    </Section>
  );
}

// ─── Insights (reports) ────────────────────────────────────────────────────

function InsightsSection() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const today = localToday();
  const overview = useReportsOverview({ date_from: shiftDate(today, -(CHART_DAYS - 1)), date_to: today, granularity: 'day' });
  const data = overview.data;
  const kpis = data?.kpis;
  const chart = useMemo(
    () => (data?.timeseries ?? []).map((p) => ({ label: fmt.date(`${p.date}T12:00:00`, 'short'), value: toNumber(p.income) })),
    [data?.timeseries, fmt],
  );
  const services = (data?.services ?? []).slice(0, 5);
  const customers = (data?.top_customers ?? []).slice(0, 5);
  const receivables = (data?.cari_receivables ?? []).slice(0, 5);
  // Plan without the reports module: leave the insights out rather than showing zeros.
  if (isFeatureDisabled(overview.error)) return null;
  const kpiItems = [
    { label: tr('dashboard.tenant.kpi_income'), value: fmt.money(kpis?.total_income) },
    { label: tr('dashboard.tenant.kpi_net'), value: fmt.money(kpis?.net_profit) },
    { label: tr('dashboard.tenant.kpi_vehicles'), value: String(kpis?.vehicles_served ?? 0) },
    { label: tr('dashboard.tenant.kpi_ticket'), value: fmt.money(kpis?.avg_ticket) },
  ];

  return (
    <>
      <Section title={tr('dashboard.tenant.revenue_title', { days: CHART_DAYS })} action={{ label: tr('dashboard.tenant.open_reports'), onPress: () => router.push('/reports') }}>
        <Card style={{ gap: t.spacing.md }}>
          <Txt variant="caption" tone="secondary">
            {tr('dashboard.tenant.revenue_desc')}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {kpiItems.map((k) => (
              <View key={k.label} style={{ width: '48.5%', flexGrow: 1, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md, paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm }}>
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {k.label}
                </Txt>
                {overview.isLoading ? <Skeleton height={20} width={70} /> : <Txt variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit style={{ fontVariant: ['tabular-nums'] }}>{k.value}</Txt>}
              </View>
            ))}
          </View>
          {overview.isLoading ? <Skeleton height={140} /> : <BarChart data={chart} formatValue={(n) => fmt.money(n)} />}
        </Card>
      </Section>

      <Section title={tr('dashboard.tenant.top_services')}>
        <Card>
          <Txt variant="caption" tone="muted" style={{ marginBottom: t.spacing.md }}>
            {tr('dashboard.tenant.last_days', { days: CHART_DAYS })}
          </Txt>
          {services.length === 0 ? (
            <Txt tone="secondary" variant="caption">{tr('reports.empty')}</Txt>
          ) : (
            <RankBars
              color={t.colors.primary}
              items={services.map((s) => ({ label: s.name, value: toNumber(s.total), display: `${s.count}× · ${fmt.moneyCompact(s.total)}` }))}
            />
          )}
        </Card>
      </Section>

      <MiniList
        title={tr('dashboard.tenant.top_customers')}
        linkLabel={tr('dashboard.tenant.all_customers')}
        onLink={() => router.push('/customers')}
        empty={tr('reports.empty')}
        items={customers.map((c) => ({
          key: c.customer_uuid,
          primary: c.customer_name,
          secondary: tr('dashboard.tenant.job_count', { count: c.job_count }),
          value: fmt.money(c.job_total),
          onPress: () => router.push(`/customers/${c.customer_uuid}`),
        }))}
      />
      <MiniList
        title={tr('dashboard.tenant.receivables')}
        linkLabel={tr('dashboard.tenant.all_cari')}
        onLink={() => router.push('/cari')}
        empty={tr('dashboard.tenant.receivables_empty')}
        valueTone="warning"
        items={receivables.map((r) => ({
          key: r.account_uuid,
          primary: r.customer_name,
          secondary: r.customer_phone || '—',
          value: fmt.money(r.balance, r.currency),
          onPress: () => router.push(`/cari/${r.account_uuid}`),
        }))}
      />
    </>
  );
}

function MiniList({
  title,
  linkLabel,
  onLink,
  empty,
  items,
  valueTone,
}: {
  title: string;
  linkLabel: string;
  onLink: () => void;
  empty: string;
  valueTone?: 'warning';
  items: { key: string; primary: string; secondary: string; value: string; onPress: () => void }[];
}) {
  const t = useTheme();
  return (
    <Section title={title} action={{ label: linkLabel, onPress: onLink }}>
      <Group>
        {items.length === 0 ? (
          <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.xl, textAlign: 'center' }}>
            {empty}
          </Txt>
        ) : (
          items.map((item, i) => (
            <ListRow
              key={item.key}
              title={item.primary}
              subtitle={item.secondary}
              left={<Avatar name={item.primary} size={32} tone="neutral" />}
              right={
                <Txt variant="mono" tone={valueTone ?? 'default'}>
                  {item.value}
                </Txt>
              }
              chevron={false}
              onPress={item.onPress}
              last={i === items.length - 1}
            />
          ))
        )}
      </Group>
    </Section>
  );
}

// ─── Setup checklist (owner) ───────────────────────────────────────────────
