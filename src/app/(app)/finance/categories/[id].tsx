import { router, useLocalSearchParams } from 'expo-router';
import { Archive, ArchiveRestore, Pencil, Tag, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Amount, Badge, Card, ErrorState, Group, Header, IconButton, InfoRow, KpiTile, ListRow, ListSkeleton, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { CategorySheet } from '@/features/finance/components/category-sheet';
import { LedgerList } from '@/features/finance/components/ledger-list';
import { categoryKindKey } from '@/features/finance/lib';
import { financeService, type FinanceCategory, type FinanceCategoryStats } from '@/features/finance/services/finance.service';
import { qk, useFinanceCategoryDetail } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

const log = createLogger('screen.finance.category');

export default function FinanceCategoryDetailScreen() {
  useLiveResource(['tenant.finance.categories', 'tenant.finance.transactions']);
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.detail.category_title')}>
      <CategoryDetail />
    </RequirePermission>
  );
}

function CategoryDetail() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const query = useFinanceCategoryDetail(id);
  const [editOpen, setEditOpen] = useState(false);
  const category = query.data?.category;
  const title = category?.name ?? tr('finance.detail.category_title');

  if (query.isLoading) {
    return (
      <Screen header={<Header title={title} />}>
        <ListSkeleton rows={4} height={96} />
      </Screen>
    );
  }
  if (query.isError || !query.data || !category) {
    return (
      <Screen header={<Header title={title} />}>
        <ErrorState error={query.error} description={tr('finance.detail.category_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Screen
        scroll={false}
        header={
          <Header
            title={title}
            subtitle={tr('finance.detail.category_description')}
            right={canWrite ? <IconButton label={tr('mobile.finance.edit_category')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => setEditOpen(true)} /> : undefined}
          />
        }
      >
        <LedgerList
          scope={{ category_uuid: category.uuid }}
          title={tr('finance.detail.category_ledger')}
          onRefresh={() => void query.refetch()}
          header={<CategorySummary category={category} stats={query.data.stats} canWrite={canWrite} onEdit={() => setEditOpen(true)} />}
        />
      </Screen>
      <CategorySheet visible={editOpen} onClose={() => setEditOpen(false)} category={category} />
    </View>
  );
}

function CategorySummary({ category, stats, canWrite, onEdit }: { category: FinanceCategory; stats: FinanceCategoryStats; canWrite: boolean; onEdit: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const income = category.kind === 'income';
  // Web hardcodes TRY for category totals (TODO there: derive from org settings).
  const currency = 'TRY';

  const patch = useApiMutation({
    key: 'finance.category.patch',
    fn: (body: Record<string, unknown>) => financeService.patchCategory(category.uuid, body),
    invalidate: [qk.finance, qk.reports],
    success: tr('mobile.finance.category_updated'),
    toastValidation: true,
    onSuccess: (c) => log.info('category patched', { uuid: c.uuid, is_active: c.is_active }),
  });
  const remove = useApiMutation({
    key: 'finance.category.delete',
    fn: () => financeService.deleteCategory(category.uuid),
    invalidate: [qk.finance, qk.reports],
    success: tr('mobile.finance.category_deleted'),
    toastValidation: true,
    onSuccess: () => {
      log.info('category deleted', { uuid: category.uuid });
      router.back();
    },
  });
  const busy = patch.isPending || remove.isPending;

  const onDelete = async () => {
    const ok = await confirm({
      title: tr('mobile.finance.delete_category'),
      message: tr('mobile.finance.delete_category_description', { name: category.name }),
      confirmLabel: tr('common.delete'),
      destructive: true,
    });
    if (ok) remove.mutate(undefined);
  };

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.md}>
          <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: income ? t.colors.successBg : t.colors.dangerBg }}>
            <Tag size={22} color={income ? t.colors.success : t.colors.danger} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="caption" tone="secondary">
              {tr('finance.detail.total_amount')}
            </Txt>
            <Amount value={stats.total_amount} currency={currency} variant="display" tone={income ? 'success' : 'danger'} />
          </View>
        </Row>
        <Row gap={t.spacing.sm} wrap>
          <Badge size="sm" tone={income ? 'success' : 'warning'} label={tr(categoryKindKey(category.kind))} />
          <Badge size="sm" tone={category.is_active ? 'success' : 'neutral'} label={category.is_active ? tr('finance.filters.active') : tr('finance.filters.inactive')} />
        </Row>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
        <KpiTile label={tr('finance.detail.posted_count')} value={fmt.number(stats.posted_count)} />
        <KpiTile label={tr('finance.detail.void_count')} value={fmt.number(stats.void_count)} />
      </View>

      <Section title={tr('finance.detail.category_info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('finance.categories.kind')} value={tr(categoryKindKey(category.kind))} />
          <InfoRow label={tr('finance.categories.sort_order')} value={String(category.sort_order)} last />
        </Card>
      </Section>

      {canWrite ? (
        <Section title={tr('mobile.finance.manage')}>
          <Group>
            <ListRow title={tr('mobile.finance.edit_category')} left={<Pencil size={20} color={t.colors.text} />} onPress={onEdit} disabled={busy} chevron={false} />
            <ListRow
              title={category.is_active ? tr('mobile.finance.deactivate_category') : tr('mobile.finance.activate_category')}
              left={category.is_active ? <Archive size={20} color={t.colors.warning} /> : <ArchiveRestore size={20} color={t.colors.success} />}
              onPress={() => patch.mutate({ is_active: !category.is_active })}
              disabled={busy}
              chevron={false}
            />
            <ListRow title={tr('mobile.finance.delete_category')} destructive left={<Trash2 size={20} color={t.colors.danger} />} onPress={onDelete} disabled={busy} chevron={false} last />
          </Group>
        </Section>
      ) : null}
    </View>
  );
}
