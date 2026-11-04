import { router } from 'expo-router';
import { CheckCircle2, FilePlus2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, Header, ListSkeleton, Row, Screen, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useLiveResource } from '@/features/live/use-live-resource';
import type { PurchaseDetail, PurchaseListItem } from '@/features/purchases/services/purchases.service';
import { usePurchasesInfinite } from '@/features/queries';
import { DocStatusBadge } from '@/features/sales/components/commerce-parts';
import { PostDraftSheet } from '@/features/stock-reorder/components/sheets';
import { useReorderAccess } from '@/features/stock-reorder/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function ReorderDraftsScreen() {
  useLiveResource('tenant.purchases');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.purchasesRead} title={tr('stock_reorder.tabs.drafts')}>
      <DraftsList />
    </RequirePermission>
  );
}

/** Open draft purchases (status=draft) with "Onayla ve alışa çevir". */
function DraftsList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { canWrite } = useReorderAccess();
  const list = usePurchasesInfinite({ status: 'draft', sort: '-purchased_at' });
  const [posting, setPosting] = useState<PurchaseDetail | null>(null);

  return (
    <Screen scroll={false} header={<Header title={tr('stock_reorder.tabs.drafts')} subtitle={tr('mobile.reorder.drafts_subtitle')} />}>
      <FlatList
        data={list.items}
        keyExtractor={(p) => p.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={3} height={110} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<FilePlus2 size={28} color={t.colors.textMuted} />}
              title={tr('stock_reorder.drafts.empty_title')}
              description={tr('stock_reorder.drafts.empty_hint')}
              action={<Button label={tr('stock_reorder.title')} variant="outline" size="sm" onPress={() => router.replace('/purchases/reorder')} />}
            />
          )
        }
        renderItem={({ item }) => <DraftCard draft={item} canWrite={canWrite} onPost={setPosting} />}
      />
      <PostDraftSheet draft={posting} onClose={() => setPosting(null)} onPosted={(p) => router.push(`/purchases/${p.uuid}`)} />
    </Screen>
  );
}

function DraftCard({ draft, canWrite, onPost }: { draft: PurchaseListItem; canWrite: boolean; onPost: (d: PurchaseDetail) => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  return (
    <Card onPress={() => router.push(`/purchases/${draft.uuid}`)} style={{ gap: 6 }} accessibilityLabel={draft.supplier_name}>
      <Row gap={t.spacing.sm}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {draft.supplier_name}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {fmt.dateTime(draft.created_at)}
          </Txt>
        </View>
        <DocStatusBadge ns="purchases" status={draft.status} />
      </Row>
      <View style={{ gap: 2 }}>
        {draft.lines.map((l) => (
          <Txt key={l.uuid} variant="caption" tone="secondary" numberOfLines={1}>
            {`${l.name} × ${fmt.number(l.qty, 3)}`}
          </Txt>
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }} gap={t.spacing.sm}>
        <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {fmt.money(draft.total_amount, draft.currency)}
        </Txt>
        {canWrite ? (
          <Button size="sm" label={tr('stock_reorder.actions.post')} icon={<CheckCircle2 size={16} color={t.colors.onPrimary} />} onPress={() => onPost(draft)} />
        ) : null}
      </Row>
    </Card>
  );
}
