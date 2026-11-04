/** Reviews — web `/t/[slug]/reviews` (`features/reviews/components/reviews-page.tsx`): KPI tiles, distribution and the request list. */
import { router, useLocalSearchParams } from 'expo-router';
import { Settings2, Star } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, KpiTile, ListSkeleton, Row, SearchBar, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useLiveResource } from '@/features/live/use-live-resource';
import { FollowUpSheet } from '@/features/reviews/components/follow-up-sheet';
import { ReviewsModuleGate } from '@/features/reviews/components/module-gate';
import { ReviewCard } from '@/features/reviews/components/review-card';
import { useReviewsAccess, useReviewsInfinite, useReviewSummary } from '@/features/reviews/queries';
import type { Review, ReviewListParams, ReviewSummary } from '@/features/reviews/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const FILTERS = ['all', 'follow_up', 'low', 'high', 'waiting', 'answered'] as const;
type Filter = (typeof FILTERS)[number];

const PERIODS = ['7', '30', '90', '365'] as const;
type Period = (typeof PERIODS)[number];

const filterParams = (f: Filter): ReviewListParams => {
  switch (f) {
    case 'follow_up':
      return { follow_up: 'required' };
    case 'low':
      return { rating: 'low' };
    case 'high':
      return { rating: 'high' };
    case 'waiting':
      return { status: 'sent' };
    case 'answered':
      return { status: 'answered' };
    default:
      return {};
  }
};

export default function ReviewsScreen() {
  useLiveResource('tenant.reviews');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.reviewsRead} title={tr('reviews.title')}>
      <ReviewsModuleGate title={tr('reviews.title')}>
        <ReviewsList />
      </ReviewsModuleGate>
    </RequirePermission>
  );
}

function ReviewsList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const access = useReviewsAccess();
  // `?filter=follow_up` (Uyarılar widget) opens the follow-up list.
  const routeParams = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<Filter>(FILTERS.includes(routeParams.filter as Filter) ? (routeParams.filter as Filter) : 'all');
  const [period, setPeriod] = useState<Period>('30');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const params = useMemo<ReviewListParams>(() => ({ ...filterParams(filter), ...(query ? { q: query } : {}) }), [filter, query]);
  const list = useReviewsInfinite(params);
  const summary = useReviewSummary(Number(period));
  const [followUp, setFollowUp] = useState<Review | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('reviews.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('mobile.reviews.subtitle')}
        right={access.canWrite ? <IconButton label={tr('reviews.settings.title')} icon={<Settings2 size={20} color={t.colors.text} />} onPress={() => router.push('/reviews/settings')} /> : undefined}
      />
      <FlatList
        data={list.items}
        keyExtractor={(x) => x.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <FilterChips<Period> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: tr('reviews.summary.last_days', { count: Number(p) }) }))} />
            <SummaryTiles data={summary.data} loading={summary.isLoading} onFollowUps={() => setFilter('follow_up')} />
            {summary.data?.answered_count ? <Distribution data={summary.data} /> : null}
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('mobile.reviews.search')} />
            <FilterChips<Filter> value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f, label: tr(`mobile.reviews.filter.${f}`) }))} />
          </View>
        }
        renderItem={({ item }) => <ReviewCard review={item} canWrite={access.canWrite} onFollowUp={setFollowUp} />}
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
            <ErrorState error={list.error} description={tr('reviews.error')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Star size={28} color={t.colors.textMuted} />}
              title={tr('reviews.empty')}
              description={tr('reviews.empty_hint')}
              action={access.canWrite ? <Button size="sm" variant="outline" label={tr('reviews.settings.title')} onPress={() => router.push('/reviews/settings')} /> : undefined}
            />
          )
        }
      />
      <FollowUpSheet review={followUp} onClose={() => setFollowUp(null)} />
    </SafeAreaView>
  );
}

function SummaryTiles({ data, loading, onFollowUps }: { data?: ReviewSummary; loading: boolean; onFollowUps: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const dash = loading ? '…' : '—';
  const tiles = [
    { key: 'avg', label: tr('reviews.summary.average'), value: data?.answered_count ? data.average_score.toFixed(1) : dash, hint: tr('reviews.summary.answered_count', { count: data?.answered_count ?? 0 }), tone: 'warning' as const },
    { key: 'rate', label: tr('reviews.summary.response_rate'), value: data ? `${Math.round(data.response_rate * 100)}%` : dash, hint: tr('reviews.summary.sent_count', { count: data?.sent_count ?? 0 }), tone: 'primary' as const },
    { key: 'nps', label: tr('reviews.summary.nps'), value: data?.answered_count ? String(data.nps) : dash, hint: tr('reviews.summary.nps_hint', { promoters: data?.promoters ?? 0, detractors: data?.detractors ?? 0 }), tone: 'success' as const },
    { key: 'google', label: tr('reviews.summary.google'), value: String(data?.google_redirects ?? 0), hint: tr('reviews.summary.google_hint'), tone: 'info' as const },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
      {data?.follow_up_required ? (
        <Card onPress={onFollowUps} accessibilityLabel={tr('reviews.summary.follow_up')} style={{ minWidth: 150, gap: 4, borderColor: t.colors.danger }}>
          <Txt variant="caption" tone="danger" numberOfLines={1}>
            {tr('reviews.summary.follow_up')}
          </Txt>
          <Txt variant="title" tone="danger" style={{ fontVariant: ['tabular-nums'] }}>
            {data.follow_up_required}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={2}>
            {tr('reviews.summary.follow_up_hint')}
          </Txt>
        </Card>
      ) : null}
      {tiles.map((x) => (
        <KpiTile key={x.key} label={x.label} value={x.value} hint={x.hint} tone={x.tone} style={{ minWidth: 150 }} />
      ))}
    </ScrollView>
  );
}

function Distribution({ data }: { data: ReviewSummary }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const max = Math.max(1, ...data.distribution.map((d) => d.count));
  return (
    <Card style={{ gap: t.spacing.xs }}>
      <Txt variant="label" tone="secondary">
        {tr('reviews.summary.distribution')}
      </Txt>
      {[...data.distribution].reverse().map((d) => (
        <Row key={d.score} gap={t.spacing.sm} style={{ alignItems: 'center' }}>
          <Txt variant="caption" style={{ width: 28, fontVariant: ['tabular-nums'] }}>
            {d.score} ★
          </Txt>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
            <View style={{ width: `${(d.count / max) * 100}%`, height: '100%', backgroundColor: d.score >= 4 ? t.colors.success : d.score === 3 ? t.colors.warning : t.colors.danger }} />
          </View>
          <Txt variant="caption" tone="muted" style={{ width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
            {d.count}
          </Txt>
        </Row>
      ))}
    </Card>
  );
}
