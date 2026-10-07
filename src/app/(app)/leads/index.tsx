/** Leads — web `/t/[slug]/leads` (`features/leads/components/leads-page.tsx`). */
import { router } from 'expo-router';
import { AlarmClock, CalendarClock, Flame, Megaphone, Plus, UserRound } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, EmptyState, ErrorState, Header, IconButton, ListSkeleton, PlateBadge, Row, SearchBar, Segmented, Skeleton, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { QuotesModuleGate } from '@/features/billing/components/module-gate';
import { P } from '@/features/auth/permissions';
import { ActionMenu, Chip } from '@/features/leads/components/crm-ui';
import { LostSheet } from '@/features/leads/components/lead-sheets';
import { TemperatureBadge, TemperatureToggle } from '@/features/leads/components/temperature-toggle';
import { leadStatusTone } from '@/features/leads/lib/lead-ui';
import { useLeadMutations, useLeadsAccess, useLeadsInfinite } from '@/features/leads/queries';
import { LEAD_STATUSES, type Lead, type LeadListParams, type LeadStatus } from '@/features/leads/types';
import { useLeadsSummary } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type StatusTab = 'open' | 'all' | 'won' | 'lost';
type Quick = 'hot' | 'mine' | 'overdue' | 'today';

export default function LeadsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.leadsRead} title={tr('leads.title')}>
      <QuotesModuleGate area="leads" title={tr('leads.title')}>
        <LeadsList />
      </QuotesModuleGate>
    </RequirePermission>
  );
}

function LeadsList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const access = useLeadsAccess();
  const [tab, setTab] = useState<StatusTab>('open');
  const [quick, setQuick] = useState<Quick | null>(null);
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const summary = useLeadsSummary();
  const { patch } = useLeadMutations();
  const [statusFor, setStatusFor] = useState<Lead | null>(null);
  const [lostFor, setLostFor] = useState<Lead | null>(null);

  const params = useMemo<LeadListParams>(() => {
    const p: LeadListParams = {};
    if (tab !== 'all') p.status = tab;
    if (quick === 'hot') p.temperature = 'hot';
    if (quick === 'mine') p.assignee = 'me';
    if (quick === 'overdue') p.follow_up = 'overdue';
    if (quick === 'today') p.follow_up = 'today';
    if (quick === 'overdue' || quick === 'today') p.sort = 'follow_up_date';
    if (query) p.q = query;
    return p;
  }, [tab, quick, query]);
  const list = useLeadsInfinite(params);
  const s = summary.data;
  const filtered = Boolean(query || quick);

  const quickChips: { key: Quick; label: string; count?: number; icon: typeof Flame }[] = [
    { key: 'overdue', label: tr('leads.quick.overdue'), count: s?.overdue, icon: AlarmClock },
    { key: 'today', label: tr('leads.quick.today'), count: s?.due_today, icon: CalendarClock },
    { key: 'hot', label: tr('leads.quick.hot'), count: s?.hot, icon: Flame },
    { key: 'mine', label: tr('leads.quick.mine'), count: s?.mine, icon: UserRound },
  ];
  const stats = [
    { label: tr('leads.summary.open'), value: s?.open },
    { label: tr('leads.summary.new'), value: s?.new },
    { label: tr('leads.summary.hot'), value: s?.hot, color: t.colors.danger },
    { label: tr('leads.summary.overdue'), value: s?.overdue, color: s?.overdue ? t.colors.danger : undefined },
    { label: tr('leads.summary.today'), value: s?.due_today },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('leads.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('mobile.crm.leads_subtitle')}
        right={access.canWrite ? <IconButton variant="primary" label={tr('leads.actions.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => router.push('/leads/form')} /> : undefined}
      />
      <FlatList
        data={list.items}
        keyExtractor={(l) => l.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <Card style={{ flexDirection: 'row', paddingVertical: t.spacing.md, paddingHorizontal: t.spacing.sm }}>
              {stats.map((stat) => (
                <View key={stat.label} style={{ flex: 1, alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`${stat.label}: ${stat.value ?? 0}`}>
                  {summary.isLoading ? (
                    <Skeleton height={22} width={24} />
                  ) : (
                    <Txt variant="heading" style={{ fontVariant: ['tabular-nums'], color: stat.color ?? t.colors.text }}>
                      {stat.value ?? 0}
                    </Txt>
                  )}
                  <Txt variant="caption" tone="muted" numberOfLines={2} style={{ fontSize: 11, textAlign: 'center' }}>
                    {stat.label}
                  </Txt>
                </View>
              ))}
            </Card>
            <Segmented<StatusTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'open', label: tr('leads.tabs.open') },
                { value: 'won', label: tr('leads.status.won') },
                { value: 'lost', label: tr('leads.status.lost') },
                { value: 'all', label: tr('leads.tabs.all') },
              ]}
            />
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('leads.search')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {quickChips.map((chip) => {
                const Icon = chip.icon;
                const active = quick === chip.key;
                return (
                  <Chip
                    key={chip.key}
                    label={chip.count ? `${chip.label} · ${chip.count}` : chip.label}
                    active={active}
                    icon={<Icon size={14} color={active ? t.colors.primary : t.colors.textSecondary} />}
                    onPress={() => setQuick(active ? null : chip.key)}
                  />
                );
              })}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => (
          <LeadCard
            lead={item}
            canWrite={access.canWrite}
            onTemperature={(temperature) => patch.mutate({ uuid: item.uuid, body: { temperature } })}
            onStatusPress={() => setStatusFor(item)}
          />
        )}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => {
              list.refetch();
              summary.refetch();
            }}
            tintColor={t.colors.primary}
          />
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={96} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('leads.error')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Megaphone size={28} color={t.colors.textMuted} />}
              title={filtered ? tr('leads.empty_filtered') : tr('leads.empty')}
              description={filtered ? undefined : tr('leads.empty_hint')}
              action={access.canWrite && !filtered ? <Button size="sm" label={tr('leads.actions.create')} icon={<Plus size={16} color={t.colors.onPrimary} />} onPress={() => router.push('/leads/form')} /> : undefined}
            />
          )
        }
      />
      <ActionMenu
        visible={statusFor !== null}
        onClose={() => setStatusFor(null)}
        title={tr('leads.fields.status')}
        actions={LEAD_STATUSES.map((st: LeadStatus) => ({
          key: st,
          label: tr(`leads.status.${st}`),
          disabled: st === statusFor?.status,
          destructive: st === 'lost',
          onPress: () => {
            const lead = statusFor;
            if (!lead) return;
            // Backend requires a reason for `lost` — ask for it like the detail page does.
            if (st === 'lost') setLostFor(lead);
            else patch.mutate({ uuid: lead.uuid, body: { status: st } });
          },
        }))}
      />
      <LostSheet
        visible={lostFor !== null}
        onClose={() => setLostFor(null)}
        pending={patch.isPending}
        onConfirm={(reason) => lostFor && patch.mutate({ uuid: lostFor.uuid, body: { status: 'lost', lost_reason: reason } }, { onSuccess: () => setLostFor(null) })}
      />
    </SafeAreaView>
  );
}

function LeadCard({ lead, canWrite, onTemperature, onStatusPress }: { lead: Lead; canWrite: boolean; onTemperature: (v: Lead['temperature']) => void; onStatusPress: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const followTone = lead.follow_up_state === 'overdue' ? 'danger' : lead.follow_up_state === 'today' ? 'warning' : 'muted';
  const followColor = lead.follow_up_state === 'overdue' ? t.colors.danger : lead.follow_up_state === 'today' ? t.colors.warning : t.colors.textMuted;
  return (
    <Card onPress={() => router.push(`/leads/${lead.uuid}`)} accessibilityLabel={lead.customer_name} style={{ gap: t.spacing.sm, paddingVertical: t.spacing.md }}>
      <Row gap={t.spacing.sm} wrap>
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {lead.customer_name}
        </Txt>
        {lead.vehicle_plate ? <PlateBadge plate={lead.vehicle_plate} size="sm" /> : null}
        <Txt variant="caption" tone="muted">
          {tr(`leads.source.${lead.source}`)}
        </Txt>
      </Row>
      <Txt variant="caption" tone="secondary" numberOfLines={1}>
        {lead.interest || lead.vehicle_text || lead.customer_phone || '—'}
      </Txt>
      <Row gap={t.spacing.sm} wrap style={{ justifyContent: 'space-between' }}>
        <Row gap={t.spacing.sm}>
          {canWrite ? <TemperatureToggle compact value={lead.temperature} onChange={onTemperature} /> : <TemperatureBadge value={lead.temperature} />}
          {canWrite ? (
            <Pressable onPress={onStatusPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${tr('leads.fields.status')}: ${tr(`leads.status.${lead.status}`)}`}>
              <Badge size="sm" tone={leadStatusTone(lead.status)} label={tr(`leads.status.${lead.status}`)} />
            </Pressable>
          ) : (
            <Badge size="sm" tone={leadStatusTone(lead.status)} label={tr(`leads.status.${lead.status}`)} />
          )}
        </Row>
        <Row gap={t.spacing.md}>
          <Row gap={4}>
            <CalendarClock size={13} color={followColor} />
            <Txt variant="caption" tone={followTone} style={{ fontWeight: lead.follow_up_state === 'overdue' || lead.follow_up_state === 'today' ? '700' : '500' }}>
              {lead.follow_up_date ? fmt.date(`${lead.follow_up_date}T12:00:00`, 'short') : '—'}
            </Txt>
          </Row>
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ maxWidth: 110 }}>
            {lead.assignee?.label ?? tr('leads.unassigned')}
          </Txt>
        </Row>
      </Row>
    </Card>
  );
}
