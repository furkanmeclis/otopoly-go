import { router, useLocalSearchParams } from 'expo-router';
import { FileStack, FileText, Plus } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, SearchBar, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { CreateInstanceSheet } from '@/features/contracts/components/contract-sheets';
import { instanceStatusLabel, instanceStatusTone, useContractsAccess } from '@/features/contracts/lib/access';
import { useContractInstancesInfinite } from '@/features/contracts/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

const STATUS_TABS = ['all', 'draft', 'pending', 'executed', 'voided'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default function ContractsScreen() {
  useLiveResource('tenant.contracts.instances');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.contractsRead} title={tr('contracts.instances.title')}>
      <ContractInstancesList />
    </RequirePermission>
  );
}

function ContractInstancesList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { canWrite } = useContractsAccess();
  const { job_uuid } = useLocalSearchParams<{ job_uuid?: string }>();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusTab>('all');
  const [createOpen, setCreateOpen] = useState(Boolean(job_uuid) && canWrite);
  const query = useDeferredValue(q.trim());
  const list = useContractInstancesInfinite({ q: query || undefined, status: status === 'all' ? undefined : status, sort: '-created_at' });
  const featureLocked = list.isError && isFeatureDisabled(list.error);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('contracts.instances.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('contracts.instances.description')}
        right={
          <>
            <IconButton label={tr('contracts.templates.title')} icon={<FileStack size={20} color={t.colors.text} />} onPress={() => router.push('/contracts/templates')} />
            {canWrite && !featureLocked ? (
              <IconButton variant="primary" label={tr('contracts.instances.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => setCreateOpen(true)} />
            ) : null}
          </>
        }
      />
      <FlatList
        data={featureLocked ? [] : list.items}
        keyExtractor={(c) => c.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('contracts.instances.search_placeholder')} />
            <FilterChips<StatusTab> value={status} onChange={setStatus} options={STATUS_TABS.map((s) => ({ value: s, label: tr(`contracts.instances.filter.${s}`) }))} />
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={76} />
          ) : featureLocked ? (
            <FeatureLockedState feature="module.contracts" />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('contracts.instances.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<FileText size={28} color={t.colors.textMuted} />}
              title={tr('contracts.instances.empty_title')}
              description={q ? undefined : tr('contracts.instances.empty_description')}
              action={canWrite && !q ? <Button label={tr('contracts.instances.create')} onPress={() => setCreateOpen(true)} /> : undefined}
            />
          )
        }
        renderItem={({ item: c }) => {
          const signers = c.signers ?? [];
          const signed = signers.filter((s) => s.status === 'signed').length;
          return (
            <Card onPress={() => router.push(`/contracts/instances/${c.uuid}`)} style={{ gap: t.spacing.xs }} accessibilityLabel={c.title}>
              <Row gap={t.spacing.sm}>
                <Txt variant="caption" tone="primary" style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {c.number_label || `SZL-${c.number}`}
                </Txt>
                <View style={{ flex: 1 }} />
                <Badge size="sm" tone={instanceStatusTone(c.status)} label={instanceStatusLabel(tr, c.status)} />
              </Row>
              <Txt variant="bodyStrong" numberOfLines={2}>
                {c.title}
              </Txt>
              <Row gap={t.spacing.md}>
                <Txt variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                  {[c.variables_resolved?.plate, c.variables_resolved?.customer_name].filter(Boolean).join(' · ') || c.subject_type}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {signers.length ? `${tr('contracts.fields.signers')}: ${signed}/${signers.length}` : '—'}
                </Txt>
              </Row>
              <Txt variant="caption" tone="muted">
                {fmt.dateTime(c.created_at)}
              </Txt>
            </Card>
          );
        }}
      />
      <CreateInstanceSheet visible={createOpen} onClose={() => setCreateOpen(false)} defaultJobUuid={job_uuid || undefined} />
    </SafeAreaView>
  );
}
