import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { ChevronLeft, ChevronRight, ClipboardList, Plus, ShoppingBag, SlidersHorizontal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Button,
  DateField,
  EmptyState,
  ErrorState,
  FilterChips,
  Header,
  IconButton,
  ListSkeleton,
  Row,
  SearchBar,
  SelectField,
  Sheet,
  SwitchRow,
  Txt,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { CloseJobSheet } from '@/features/jobs/components/close-job-sheet';
import { JobCard, useNow, type JobQuickAction } from '@/features/jobs/components/job-parts';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { jobsService, type Job } from '@/features/jobs/services/jobs.service';
import { qk, useJobsSummary } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';

type ListFilter = 'all' | 'in_progress' | 'ready' | 'delivered' | 'closed';
const LIVE_REFRESH_MS = 30_000;
const ALL = '__all__';

function fold(v: string) {
  return v
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[ğ]/g, 'g')
    .replace(/[ü]/g, 'u')
    .replace(/[ş]/g, 's')
    .replace(/[ö]/g, 'o')
    .replace(/[ç]/g, 'c')
    .replace(/\s+/g, '');
}

function matchesJob(job: Job, q: string) {
  const needle = fold(q);
  if (!needle) return true;
  return [job.plate, job.customer_name, job.customer_phone, job.assignee_name ?? '', job.vehicle_label].some((f) => fold(f ?? '').includes(needle));
}

export default function OperationsScreen() {
  useMarkInteractive();
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.jobsRead} title={tr('jobs.title')}>
      <OperationsBoard />
    </RequirePermission>
  );
}

function OperationsBoard() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const canWrite = can(P.jobsWrite);
  const now = useNow();
  const [date, setDate] = useState(localToday);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState(ALL);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingUuid, setPendingUuid] = useState<string | null>(null);
  const [payJob, setPayJob] = useState<Job | null>(null);
  const isToday = date === localToday();
  // The tab stays mounted all session: poll only while it is on screen (AppState pauses it in the background).
  const focused = useIsFocused();

  // Whole day once; filter client-side so counts stay visible (web behaviour).
  const params = { limit: 100, offset: 0, sort: '-started_at', date_from: date, date_to: date, include_open: isToday ? 'true' : undefined };
  const list = useQuery({
    queryKey: [...qk.jobs, 'list', params],
    queryFn: () => jobsService.list(params),
    refetchInterval: isToday && focused ? LIVE_REFRESH_MS : false,
    placeholderData: keepPreviousData,
  });
  const summary = useJobsSummary(date);
  const allJobs = useMemo(() => list.data?.items ?? [], [list.data]);

  const assignees = useMemo(() => [...new Set(allJobs.map((j) => j.assignee_name).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'tr')), [allJobs]);
  const filtered = useMemo(
    () => allJobs.filter((j) => matchesJob(j, search) && (assignee === ALL || j.assignee_name === assignee) && (!unpaidOnly || j.payment_status === 'unpaid')),
    [allJobs, search, assignee, unpaidOnly],
  );
  const isClosed = (j: Job) => j.status === 'cancelled' || j.status === 'voided';
  const count = (f: ListFilter) => (f === 'all' ? filtered.filter((j) => !isClosed(j)).length : f === 'closed' ? filtered.filter(isClosed).length : filtered.filter((j) => j.status === f).length);
  const shown = filter === 'all' ? filtered.filter((j) => !isClosed(j)) : filter === 'closed' ? filtered.filter(isClosed) : filtered.filter((j) => j.status === filter);
  const truncated = (list.data?.total ?? 0) > allJobs.length;
  const activeFilters = Number(assignee !== ALL) + Number(unpaidOnly);

  const ready = useApiMutation({ key: 'jobs.ready', fn: (uuid: string) => jobsService.ready(uuid), invalidate: [qk.jobs, qk.reports], success: tr('jobs.toast.ready'), toastValidation: true });
  const deliver = useApiMutation({ key: 'jobs.deliver', fn: (uuid: string) => jobsService.deliver(uuid), invalidate: [qk.jobs, qk.reports], success: tr('jobs.toast.delivered'), toastValidation: true });

  const runAction = async (job: Job, action: JobQuickAction) => {
    if (action === 'pay') {
      setPayJob(job);
      return;
    }
    setPendingUuid(job.uuid);
    try {
      if (action === 'ready') await ready.mutateAsync(job.uuid);
      else {
        await deliver.mutateAsync(job.uuid);
        // Delivered but unpaid: take the payment right here (web behaviour).
        if (job.payment_status === 'unpaid') setPayJob(job);
      }
    } catch {
      // toast shown by the mutation
    } finally {
      setPendingUuid(null);
    }
  };

  const s = summary.data;
  const stats = [
    { label: tr('jobs.board.cars'), value: String(s?.job_count ?? allJobs.length) },
    { label: tr('jobs.summary.paid_total'), value: fmt.money(s?.paid_total), accent: true },
    { label: tr('jobs.summary.card_total'), value: fmt.money(s?.card_total) },
    { label: tr('jobs.summary.cari_total'), value: fmt.money(s?.cari_total) },
    { label: tr('jobs.summary.net_total'), value: fmt.money(s?.net_total) },
  ];

  const header = (
    <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.md }}>
      {/* Day switcher */}
      <Row gap={t.spacing.sm}>
        <IconButton label={tr('mobile.common.previous_day')} icon={<ChevronLeft size={20} color={t.colors.text} />} onPress={() => setDate((d) => shiftDate(d, -1))} />
        <View style={{ flex: 1 }}>
          <DateField value={date} onChange={(v) => v && setDate(v)} maximumDate={new Date()} />
        </View>
        <IconButton label={tr('mobile.common.next_day')} icon={<ChevronRight size={20} color={t.colors.text} />} onPress={() => setDate((d) => shiftDate(d, 1))} disabled={isToday} />
      </Row>
      {/* Day summary */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
        {stats.map((st) => (
          <View
            key={st.label}
            style={{
              minWidth: 110,
              paddingHorizontal: t.spacing.md,
              paddingVertical: t.spacing.sm,
              borderRadius: t.radius.md,
              backgroundColor: st.accent ? t.colors.primarySoft : t.colors.surface,
              borderWidth: 1,
              borderColor: st.accent ? t.colors.primarySoft : t.colors.border,
            }}
          >
            <Txt variant="caption" tone={st.accent ? 'primary' : 'secondary'} numberOfLines={1}>
              {st.label}
            </Txt>
            <Txt variant="bodyStrong" tone={st.accent ? 'primary' : 'default'} style={{ fontVariant: ['tabular-nums'] }}>
              {summary.isLoading ? '…' : st.value}
            </Txt>
          </View>
        ))}
      </ScrollView>
      <Row gap={t.spacing.sm}>
        <View style={{ flex: 1 }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder={tr('jobs.search_placeholder')} />
        </View>
        <IconButton label={tr('jobs.board.view')} icon={<SlidersHorizontal size={18} color={activeFilters ? t.colors.primary : t.colors.text} />} badge={activeFilters || undefined} onPress={() => setFiltersOpen(true)} />
      </Row>
      <FilterChips<ListFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: tr('jobs.filter.all'), count: count('all') },
          { value: 'in_progress', label: tr('jobs.status.in_progress'), count: count('in_progress') },
          { value: 'ready', label: tr('jobs.status.ready'), count: count('ready') },
          { value: 'delivered', label: tr('jobs.status.delivered'), count: count('delivered') },
          { value: 'closed', label: tr('jobs.board.closed'), count: count('closed') },
        ]}
      />
      {truncated ? (
        <Txt variant="caption" tone="warning">
          {tr('jobs.board.truncated', { total: list.data?.total ?? 0, shown: allJobs.length })}
        </Txt>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        back={false}
        title={tr('jobs.title')}
        subtitle={tr('jobs.description')}
        right={
          <>
            {can(P.salesWrite) ? <IconButton label={tr('sales.quick.title')} icon={<ShoppingBag size={18} color={t.colors.text} />} onPress={() => router.push('/sales/new')} /> : null}
            {canWrite ? <IconButton variant="primary" label={tr('jobs.actions.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => router.push('/jobs/new')} /> : null}
          </>
        }
      />
      <FlatList
        data={list.isLoading ? [] : shown}
        keyExtractor={(j) => j.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.md }}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isLoading} onRefresh={() => void Promise.all([list.refetch(), summary.refetch()])} tintColor={t.colors.primary} />}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={4} height={130} />
          ) : list.isError ? (
            <ErrorState onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<ClipboardList size={28} color={t.colors.textMuted} />}
              title={allJobs.length === 0 && isToday ? tr('jobs.board.empty_today') : filter !== 'all' && filter !== 'closed' ? tr(`jobs.board.empty.${filter}`) : tr('jobs.empty_title')}
              description={allJobs.length === 0 ? tr('jobs.board.empty_hint') : undefined}
              action={canWrite && allJobs.length === 0 ? <Button label={tr('jobs.actions.create')} onPress={() => router.push('/jobs/new')} /> : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <JobCard job={item} now={now} canWrite={canWrite} pending={pendingUuid === item.uuid} onPress={() => router.push(`/jobs/${item.uuid}`)} onAction={runAction} />
        )}
      />

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title={tr('jobs.board.view')}>
        <SelectField
          label={tr('jobs.assignee')}
          value={assignee}
          onChange={(v) => setAssignee(v ?? ALL)}
          options={[{ value: ALL, label: tr('jobs.board.all_assignees') }, ...assignees.map((a) => ({ value: a, label: a }))]}
        />
        <SwitchRow label={tr('jobs.board.unpaid_only')} value={unpaidOnly} onValueChange={setUnpaidOnly} />
        {activeFilters ? (
          <Pressable
            onPress={() => {
              setAssignee(ALL);
              setUnpaidOnly(false);
            }}
            style={{ alignSelf: 'flex-start', paddingVertical: t.spacing.sm }}
          >
            <Txt tone="primary" style={{ fontWeight: '700' }}>
              {tr('jobs.board.clear_filters')}
            </Txt>
          </Pressable>
        ) : null}
      </Sheet>

      <CloseJobSheet job={payJob} visible={Boolean(payJob)} onClose={() => setPayJob(null)} />
    </SafeAreaView>
  );
}

