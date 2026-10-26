/**
 * Loyalty & packages — web `/t/[slug]/loyalty` (`features/loyalty/components/loyalty-page.tsx`): stamp campaigns,
 * package definitions, subscription plans, packages sold and subscriptions, each a paged list with its create /
 * edit sheet. `?tab=` opens a tab (the home renewals card opens subscriptions).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Gift, Package, Plus, Repeat, Stamp, Ticket } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, Screen, SearchBar, Skeleton, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { useLiveResource } from '@/features/live/use-live-resource';
import { CampaignSheet, PackageSheet, PlanSheet } from '@/features/loyalty/components/program-sheets';
import { SellPackageSheet, StartSubscriptionSheet } from '@/features/loyalty/components/sale-sheets';
import { dayDate, eligibilityLabel, PACKAGE_STATE_TONE, planUsesLabel, renewalLabel, rewardLabel, SUBSCRIPTION_STATE_TONE } from '@/features/loyalty/lib/labels';
import {
  useCampaignsInfinite,
  useCustomerPackagesInfinite,
  useLoyaltyAccess,
  useLoyaltyOverview,
  usePackagesInfinite,
  usePlansInfinite,
  useSubscriptionsInfinite,
} from '@/features/loyalty/queries';
import type { CustomerPackage, LoyaltyCampaign, LoyaltyPackage, LoyaltyPlan, PackageState, Subscription, SubscriptionState } from '@/features/loyalty/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Tab = 'campaigns' | 'packages' | 'plans' | 'sold' | 'subscriptions';
const TABS: Tab[] = ['campaigns', 'packages', 'plans', 'sold', 'subscriptions'];

export default function LoyaltyScreen() {
  useLiveResource(['tenant.loyalty.programs', 'tenant.loyalty.packages', 'tenant.loyalty.subscriptions']);
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.loyaltyRead} title={tr('loyalty.title')}>
      <LoyaltyHub />
    </RequirePermission>
  );
}

function LoyaltyHub() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const params = useLocalSearchParams<{ tab?: string }>();
  const access = useLoyaltyAccess();
  const [tab, setTab] = useState<Tab>(TABS.includes(params.tab as Tab) ? (params.tab as Tab) : 'campaigns');
  const overview = useLoyaltyOverview(7);
  const [sheet, setSheet] = useState<{ kind: 'campaign'; row: LoyaltyCampaign | null } | { kind: 'package'; row: LoyaltyPackage | null } | { kind: 'plan'; row: LoyaltyPlan | null } | { kind: 'sell' } | { kind: 'start' } | null>(null);

  if (isFeatureDisabled(overview.error)) {
    return (
      <Screen header={<Header title={tr('loyalty.title')} />}>
        <FeatureLockedState feature="loyalty.enabled" />
      </Screen>
    );
  }

  const create: Record<Tab, (() => void) | null> = {
    campaigns: access.canWrite ? () => setSheet({ kind: 'campaign', row: null }) : null,
    packages: access.canWrite ? () => setSheet({ kind: 'package', row: null }) : null,
    plans: access.canWrite ? () => setSheet({ kind: 'plan', row: null }) : null,
    sold: access.canApply ? () => setSheet({ kind: 'sell' }) : null,
    subscriptions: access.canApply ? () => setSheet({ kind: 'start' }) : null,
  };
  const createLabel: Record<Tab, string> = {
    campaigns: tr('loyalty.campaigns.new'),
    packages: tr('loyalty.packages.new'),
    plans: tr('loyalty.plans.new'),
    sold: tr('loyalty.sell.title'),
    subscriptions: tr('loyalty.start.title'),
  };
  const onCreate = create[tab];
  const o = overview.data;
  const stats = [
    { label: tr('loyalty.stats.campaigns'), value: o?.active_campaigns },
    { label: tr('loyalty.stats.packages_active'), value: o?.customer_packages_active },
    { label: tr('loyalty.stats.subscriptions'), value: o?.subscriptions_active },
    { label: tr('loyalty.stats.renewals', { days: o?.horizon_days ?? 7 }), value: o ? o.renewals_upcoming + o.subscriptions_past_due : undefined, warn: Boolean(o?.subscriptions_past_due) },
  ];

  const header = (
    <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
      <Card style={{ flexDirection: 'row', paddingVertical: t.spacing.md, paddingHorizontal: t.spacing.sm }}>
        {stats.map((s) => (
          <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`${s.label}: ${s.value ?? 0}`}>
            {overview.isLoading ? (
              <Skeleton height={22} width={24} />
            ) : (
              <Txt variant="heading" style={{ fontVariant: ['tabular-nums'], color: s.warn ? t.colors.warning : t.colors.text }}>
                {s.value ?? 0}
              </Txt>
            )}
            <Txt variant="caption" tone="muted" numberOfLines={2} style={{ fontSize: 11, textAlign: 'center' }}>
              {s.label}
            </Txt>
          </View>
        ))}
      </Card>
      <FilterChips<Tab> value={tab} onChange={setTab} options={TABS.map((v) => ({ value: v, label: tr(`loyalty.tabs.${v}`) }))} />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('loyalty.title')}
        subtitle={tr(`loyalty.tabs.${tab}`)}
        right={onCreate ? <IconButton variant="primary" label={createLabel[tab]} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={onCreate} /> : undefined}
      />
      {tab === 'campaigns' ? (
        <CampaignsTab header={header} onOpen={access.canWrite ? (row) => setSheet({ kind: 'campaign', row }) : undefined} onCreate={onCreate} refetchOverview={overview.refetch} />
      ) : tab === 'packages' ? (
        <PackagesTab header={header} onOpen={access.canWrite ? (row) => setSheet({ kind: 'package', row }) : undefined} onCreate={onCreate} refetchOverview={overview.refetch} />
      ) : tab === 'plans' ? (
        <PlansTab header={header} onOpen={access.canWrite ? (row) => setSheet({ kind: 'plan', row }) : undefined} onCreate={onCreate} refetchOverview={overview.refetch} />
      ) : tab === 'sold' ? (
        <SoldTab header={header} onCreate={onCreate} refetchOverview={overview.refetch} />
      ) : (
        <SubscriptionsTab header={header} onCreate={onCreate} refetchOverview={overview.refetch} />
      )}
      <CampaignSheet visible={sheet?.kind === 'campaign'} campaign={sheet?.kind === 'campaign' ? sheet.row : null} onClose={() => setSheet(null)} />
      <PackageSheet visible={sheet?.kind === 'package'} pkg={sheet?.kind === 'package' ? sheet.row : null} onClose={() => setSheet(null)} />
      <PlanSheet visible={sheet?.kind === 'plan'} plan={sheet?.kind === 'plan' ? sheet.row : null} onClose={() => setSheet(null)} />
      <SellPackageSheet visible={sheet?.kind === 'sell'} onClose={() => setSheet(null)} onSold={(uuid) => router.push(`/loyalty/customer-packages/${uuid}`)} />
      <StartSubscriptionSheet visible={sheet?.kind === 'start'} onClose={() => setSheet(null)} onStarted={(uuid) => router.push(`/loyalty/subscriptions/${uuid}`)} />
    </SafeAreaView>
  );
}

// ─── Shared list ───────────────────────────────────────────────────────────

type Paged<T> = {
  items: T[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isRefetching: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
};

function PagedList<T extends { uuid: string }>({
  list,
  header,
  renderItem,
  empty,
  refetchOverview,
}: {
  list: Paged<T>;
  header: ReactElement;
  renderItem: (item: T) => ReactElement;
  empty: { icon: ReactElement; title: string; description?: string; action?: ReactElement };
  refetchOverview: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <FlatList
      data={list.items}
      keyExtractor={(i) => i.uuid}
      contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
      ListHeaderComponent={header}
      renderItem={({ item }) => renderItem(item)}
      onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => {
            void list.refetch();
            refetchOverview();
          }}
          tintColor={t.colors.primary}
        />
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
      ListEmptyComponent={
        list.isLoading ? (
          <ListSkeleton rows={4} height={88} />
        ) : list.isError ? (
          <ErrorState error={list.error} description={tr('loyalty.errors.list')} onRetry={() => void list.refetch()} />
        ) : (
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
        )
      }
    />
  );
}

function useSearch() {
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  return { q, setQ, query };
}

function CreateButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return <Button size="sm" label={label} icon={<Plus size={16} color={t.colors.onPrimary} />} onPress={onPress} />;
}

function ActiveBadge({ active }: { active: boolean }) {
  const { t: tr } = useLocale();
  return <Badge size="sm" tone={active ? 'success' : 'neutral'} label={active ? tr('common.active') : tr('common.passive')} />;
}

type TabProps<T> = { header: ReactElement; onOpen?: (row: T) => void; onCreate: (() => void) | null; refetchOverview: () => void };

// ─── Tabs ──────────────────────────────────────────────────────────────────

function CampaignsTab({ header, onOpen, onCreate, refetchOverview }: TabProps<LoyaltyCampaign>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const s = useSearch();
  const list = useCampaignsInfinite(useMemo(() => (s.query ? { q: s.query } : {}), [s.query]));
  return (
    <PagedList
      list={list}
      refetchOverview={refetchOverview}
      header={
        <View style={{ gap: t.spacing.md }}>
          {header}
          <SearchBar value={s.q} onChangeText={s.setQ} placeholder={tr('common.search')} />
        </View>
      }
      empty={{ icon: <Stamp size={28} color={t.colors.textMuted} />, title: tr('loyalty.campaigns.empty_title'), description: tr('loyalty.campaigns.empty_description'), action: onCreate ? <CreateButton label={tr('loyalty.campaigns.new')} onPress={onCreate} /> : undefined }}
      renderItem={(c) => (
        <Card onPress={onOpen ? () => onOpen(c) : undefined} accessibilityLabel={c.name} style={{ gap: 6 }}>
          <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {c.name}
            </Txt>
            <ActiveBadge active={c.is_active} />
          </Row>
          <Txt variant="caption" tone="secondary">
            {tr('loyalty.campaigns.stamps_value', { count: c.stamps_required })} → {rewardLabel(tr, fmt.money, c)}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={2}>
            {eligibilityLabel(c)}
            {c.valid_until ? ` · ${tr('loyalty.fields.valid_until')}: ${fmt.date(dayDate(c.valid_until))}` : ''}
          </Txt>
        </Card>
      )}
    />
  );
}

function PackagesTab({ header, onOpen, onCreate, refetchOverview }: TabProps<LoyaltyPackage>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const s = useSearch();
  const list = usePackagesInfinite(useMemo(() => (s.query ? { q: s.query } : {}), [s.query]));
  return (
    <PagedList
      list={list}
      refetchOverview={refetchOverview}
      header={
        <View style={{ gap: t.spacing.md }}>
          {header}
          <SearchBar value={s.q} onChangeText={s.setQ} placeholder={tr('common.search')} />
        </View>
      }
      empty={{ icon: <Package size={28} color={t.colors.textMuted} />, title: tr('loyalty.packages.empty_title'), description: tr('loyalty.packages.empty_description'), action: onCreate ? <CreateButton label={tr('loyalty.packages.new')} onPress={onCreate} /> : undefined }}
      renderItem={(p) => (
        <Card onPress={onOpen ? () => onOpen(p) : undefined} accessibilityLabel={p.name} style={{ gap: 6 }}>
          <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {p.name}
            </Txt>
            <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
              {fmt.money(p.price, p.currency)}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary" numberOfLines={2}>
            {p.items.map((i) => `${i.quantity}× ${i.service_name}`).join(', ')}
          </Txt>
          <Row gap={t.spacing.sm} wrap>
            <ActiveBadge active={p.is_active} />
            <Txt variant="caption" tone="muted">
              {[p.validity_days ? tr('loyalty.packages.valid_days', { count: p.validity_days }) : tr('loyalty.packages.no_expiry'), `${tr('loyalty.packages.sold')}: ${p.sold_count}`].join(' · ')}
            </Txt>
          </Row>
        </Card>
      )}
    />
  );
}

function PlansTab({ header, onOpen, onCreate, refetchOverview }: TabProps<LoyaltyPlan>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const s = useSearch();
  const list = usePlansInfinite(useMemo(() => (s.query ? { q: s.query } : {}), [s.query]));
  return (
    <PagedList
      list={list}
      refetchOverview={refetchOverview}
      header={
        <View style={{ gap: t.spacing.md }}>
          {header}
          <SearchBar value={s.q} onChangeText={s.setQ} placeholder={tr('common.search')} />
        </View>
      }
      empty={{ icon: <Repeat size={28} color={t.colors.textMuted} />, title: tr('loyalty.plans.empty_title'), description: tr('loyalty.plans.empty_description'), action: onCreate ? <CreateButton label={tr('loyalty.plans.new')} onPress={onCreate} /> : undefined }}
      renderItem={(p) => (
        <Card onPress={onOpen ? () => onOpen(p) : undefined} accessibilityLabel={p.name} style={{ gap: 6 }}>
          <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {p.name}
            </Txt>
            <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
              {fmt.money(p.price, p.currency)}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {planUsesLabel(tr, p)}
          </Txt>
          <Row gap={t.spacing.sm} wrap>
            <ActiveBadge active={p.is_active} />
            <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {`${tr('loyalty.plans.active_count')}: ${p.active_count} · ${eligibilityLabel(p)}`}
            </Txt>
          </Row>
        </Card>
      )}
    />
  );
}

function SoldTab({ header, onCreate, refetchOverview }: Omit<TabProps<CustomerPackage>, 'onOpen'>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const s = useSearch();
  const [state, setState] = useState<PackageState | 'all'>('active');
  const params = useMemo(() => ({ ...(s.query ? { q: s.query } : {}), ...(state !== 'all' ? { state } : {}) }), [s.query, state]);
  const list = useCustomerPackagesInfinite(params);
  return (
    <PagedList
      list={list}
      refetchOverview={refetchOverview}
      header={
        <View style={{ gap: t.spacing.md }}>
          {header}
          <SearchBar value={s.q} onChangeText={s.setQ} placeholder={tr('loyalty.fields.search_customer')} />
          <FilterChips<PackageState | 'all'>
            value={state}
            onChange={setState}
            options={[
              { value: 'active', label: tr('loyalty.package_state.active') },
              { value: 'used_up', label: tr('loyalty.package_state.used_up') },
              { value: 'expired', label: tr('loyalty.package_state.expired') },
              { value: 'cancelled', label: tr('loyalty.package_state.cancelled') },
              { value: 'all', label: tr('mobile.loyalty.all') },
            ]}
          />
        </View>
      }
      empty={{ icon: <Ticket size={28} color={t.colors.textMuted} />, title: tr('loyalty.sold.empty_title'), description: tr('loyalty.sold.empty_description'), action: onCreate ? <CreateButton label={tr('loyalty.sell.title')} onPress={onCreate} /> : undefined }}
      renderItem={(p) => (
        <Card onPress={() => router.push(`/loyalty/customer-packages/${p.uuid}`)} accessibilityLabel={`${p.name}, ${p.customer_name}`} style={{ gap: 6 }}>
          <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {p.customer_name}
            </Txt>
            <Badge size="sm" tone={PACKAGE_STATE_TONE[p.state]} label={tr(`loyalty.package_state.${p.state}`)} />
          </Row>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {p.name} · {tr('loyalty.packages.credits_left', { left: p.credits_total - p.credits_used, total: p.credits_total })}
          </Txt>
          <Txt variant="caption" tone="muted">
            {[fmt.date(p.purchased_at), fmt.money(p.price, p.currency), p.expires_at ? tr('loyalty.packages.expires_on', { date: fmt.date(p.expires_at) }) : null].filter(Boolean).join(' · ')}
          </Txt>
        </Card>
      )}
    />
  );
}

function SubscriptionsTab({ header, onCreate, refetchOverview }: Omit<TabProps<Subscription>, 'onOpen'>) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const s = useSearch();
  const [state, setState] = useState<SubscriptionState | 'due' | 'all'>('all');
  const params = useMemo(
    () => ({ ...(s.query ? { q: s.query } : {}), ...(state === 'due' ? { due_within_days: 7 } : state !== 'all' ? { state } : {}) }),
    [s.query, state],
  );
  const list = useSubscriptionsInfinite(params);
  return (
    <PagedList
      list={list}
      refetchOverview={refetchOverview}
      header={
        <View style={{ gap: t.spacing.md }}>
          {header}
          <SearchBar value={s.q} onChangeText={s.setQ} placeholder={tr('loyalty.fields.search_customer')} />
          <FilterChips<SubscriptionState | 'due' | 'all'>
            value={state}
            onChange={setState}
            options={[
              { value: 'all', label: tr('mobile.loyalty.all') },
              { value: 'due', label: tr('loyalty.widget.title') },
              { value: 'active', label: tr('loyalty.subscription_state.active') },
              { value: 'past_due', label: tr('loyalty.subscription_state.past_due') },
              { value: 'cancelled', label: tr('loyalty.subscription_state.cancelled') },
            ]}
          />
        </View>
      }
      empty={{ icon: <Gift size={28} color={t.colors.textMuted} />, title: tr('loyalty.subscriptions.empty_title'), description: tr('loyalty.subscriptions.empty_description'), action: onCreate ? <CreateButton label={tr('loyalty.start.title')} onPress={onCreate} /> : undefined }}
      renderItem={(sub) => (
        <Card onPress={() => router.push(`/loyalty/subscriptions/${sub.uuid}`)} accessibilityLabel={`${sub.name}, ${sub.customer_name}`} style={{ gap: 6 }}>
          <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {sub.customer_name}
            </Txt>
            <Badge size="sm" tone={SUBSCRIPTION_STATE_TONE[sub.state]} label={tr(`loyalty.subscription_state.${sub.state}`)} />
          </Row>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {[sub.name, sub.plate, fmt.money(sub.price, sub.currency)].filter(Boolean).join(' · ')}
          </Txt>
          {sub.state !== 'cancelled' ? (
            <Txt variant="caption" tone={sub.state === 'past_due' ? 'warning' : 'muted'}>
              {`${tr('loyalty.fields.renewal_date')}: ${fmt.date(dayDate(sub.renewal_date))} (${renewalLabel(tr, sub.days_until_renewal)})`}
            </Txt>
          ) : null}
        </Card>
      )}
    />
  );
}
