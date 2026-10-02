/** Quotes — web `/t/[slug]/quotes` (`features/quotes/components/quotes-page.tsx`). */
import { router } from 'expo-router';
import { Briefcase, Eye, FileText, Plus } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, PlateBadge, Row, SearchBar, Skeleton, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { QuotesModuleGate } from '@/features/billing/components/module-gate';
import { P } from '@/features/auth/permissions';
import { useQuotesSummary } from '@/features/queries';
import { isOpenQuote, quoteAccent, quoteStatusTone } from '@/features/quotes/lib/quote-ui';
import { useQuotesAccess, useQuotesInfinite } from '@/features/quotes/queries';
import type { Quote, QuoteListParams } from '@/features/quotes/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const TABS = ['open', 'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'all'] as const;
type Tab = (typeof TABS)[number];

export default function QuotesScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.quotesRead} title={tr('quotes.title')}>
      <QuotesModuleGate area="quotes" title={tr('quotes.title')}>
        <QuotesList />
      </QuotesModuleGate>
    </RequirePermission>
  );
}

function QuotesList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const access = useQuotesAccess();
  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const params = useMemo<QuoteListParams>(() => ({ ...(tab !== 'all' ? { status: tab } : {}), ...(query ? { q: query } : {}) }), [tab, query]);
  const list = useQuotesInfinite(params);
  const summary = useQuotesSummary();
  const s = summary.data;
  const money = (v?: string) => fmt.money(v ?? '0', s?.currency ?? 'TRY');

  const stats = [
    { label: tr('quotes.summary.accepted_pending'), value: String(s?.accepted_pending_count ?? 0), color: s?.accepted_pending_count ? t.colors.success : undefined },
    { label: tr('quotes.summary.awaiting'), value: String(s?.awaiting_count ?? 0) },
    { label: tr('quotes.summary.pending_total'), value: money(s?.pending_total), color: t.colors.primary },
    { label: tr('quotes.summary.expiring'), value: String(s?.expiring_soon ?? 0), color: s?.expiring_soon ? t.colors.warning : undefined },
    { label: tr('quotes.summary.accepted_month'), value: `${s?.accepted_month ?? 0} · ${money(s?.accepted_month_total)}` },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('quotes.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('mobile.crm.quotes_subtitle')}
        right={access.canWrite ? <IconButton variant="primary" label={tr('quotes.actions.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => router.push('/quotes/form')} /> : undefined}
      />
      <FlatList
        data={list.items}
        keyExtractor={(x) => x.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {stats.map((stat) => (
                <Card key={stat.label} style={{ minWidth: 130, paddingVertical: t.spacing.md, gap: 4 }}>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {stat.label}
                  </Txt>
                  {summary.isLoading ? (
                    <Skeleton height={20} width={60} />
                  ) : (
                    <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'], color: stat.color ?? t.colors.text }}>
                      {stat.value}
                    </Txt>
                  )}
                </Card>
              ))}
            </ScrollView>
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('quotes.search')} />
            <FilterChips<Tab> value={tab} onChange={setTab} options={TABS.map((k) => ({ value: k, label: k === 'open' || k === 'all' ? tr(`quotes.tabs.${k}`) : tr(`quotes.status.${k}`) }))} />
            {tab === 'open' ? (
              <Txt variant="caption" tone="muted">
                {tr('quotes.tabs.open_hint')}
              </Txt>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <QuoteCard quote={item} />}
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
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={84} />
          ) : list.isError ? (
            <ErrorState description={tr('quotes.error')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<FileText size={28} color={t.colors.textMuted} />}
              title={query ? tr('quotes.empty_filtered') : tr('quotes.empty')}
              description={query ? undefined : tr('quotes.empty_hint')}
              action={access.canWrite && !query ? <Button size="sm" label={tr('quotes.actions.create')} icon={<Plus size={16} color={t.colors.onPrimary} />} onPress={() => router.push('/quotes/form')} /> : undefined}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const accent = quoteAccent(quote.status);
  const stripe = accent ? { info: t.colors.info, warning: t.colors.warning, success: t.colors.success, danger: t.colors.danger, neutral: t.colors.border, primary: t.colors.primary }[accent] : t.colors.border;
  const accepted = quote.status === 'accepted';
  const pastValid = isOpenQuote(quote.status) && quote.is_past_valid_until;
  return (
    <Card
      onPress={() => router.push(`/quotes/${quote.uuid}`)}
      accessibilityLabel={`${quote.number} ${quote.customer_name}`}
      style={{ gap: 6, paddingVertical: t.spacing.md, borderLeftWidth: 4, borderLeftColor: stripe, backgroundColor: accepted ? t.colors.successBg : t.colors.surface }}
    >
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'], fontWeight: '700' }}>
          {quote.number}
        </Txt>
        <Row gap={6}>
          {quote.viewed_at ? <Eye size={14} color={t.colors.textMuted} /> : null}
          <Badge size="sm" tone={quoteStatusTone(quote.status)} label={tr(`quotes.status.${quote.status}`)} />
        </Row>
      </Row>
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {quote.customer_name}
        </Txt>
        <Txt variant="mono" style={{ color: accepted ? t.colors.success : t.colors.text }}>
          {fmt.money(quote.grand_total, quote.currency)}
        </Txt>
      </Row>
      <Row gap={t.spacing.sm} wrap style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flexShrink: 1 }}>
          {quote.vehicle_plate ? <PlateBadge plate={quote.vehicle_plate} size="sm" /> : null}
          <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {quote.vehicle_label || tr('quotes.lines_count', { count: quote.line_count })}
          </Txt>
        </Row>
        <Row gap={t.spacing.sm}>
          {accepted ? (
            quote.job_uuid ? (
              <Row gap={4}>
                <Briefcase size={12} color={t.colors.textMuted} />
                <Txt variant="caption" tone="muted">
                  {tr('quotes.row.converted')}
                </Txt>
              </Row>
            ) : (
              <Badge size="sm" tone="success" icon={<Briefcase size={11} color={t.colors.success} />} label={tr('quotes.row.convert')} />
            )
          ) : null}
          <Txt variant="caption" tone={pastValid ? 'danger' : 'muted'}>
            {quote.valid_until ? fmt.date(`${quote.valid_until}T12:00:00`, 'short') : '—'}
          </Txt>
        </Row>
      </Row>
    </Card>
  );
}
