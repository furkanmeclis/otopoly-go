import { router } from 'expo-router';
import { Plus, Upload } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, EmptyState, ErrorState, Header, ListSkeleton, Row, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { TENANT_IMPORTS } from '@/features/io/lib/import-resources';
import { IMPORTS_GATE } from '@/features/io/lib/gates';
import { formatImportFormat, formatImportStatus, formatResource, importStatusTone, isImportRunning, rollbackWindowOpen } from '@/features/io/lib/display';
import { IO_POLL_MS, ioKeys, useImportJobsInfinite } from '@/features/io/queries';
import { importsService } from '@/features/io/services/imports.service';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function ImportsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={IMPORTS_GATE} title={tr('imports.title')}>
      <ImportsList />
    </RequirePermission>
  );
}

function ImportsList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const list = useImportJobsInfinite();
  const { can } = useAuth();
  const canUpload = TENANT_IMPORTS.some((r) => can(r.perm));
  const [nowMs] = useState(() => Date.now());
  const running = list.items.some((j) => isImportRunning(j.status));
  const { refetch } = list;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => refetch(), IO_POLL_MS);
    return () => clearInterval(id);
  }, [running, refetch]);

  const rollback = useApiMutation({
    key: 'imports.rollback',
    fn: (uuid: string) => importsService.rollback(uuid),
    invalidate: [ioKeys.imports],
    success: tr('imports.toast.rollback_success'),
    toastValidation: true,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header title={tr('imports.title')} subtitle={list.total ? tr('common.items_other', { count: list.total }) : undefined} />
      <FlatList
        data={list.items}
        keyExtractor={(j) => j.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.xs, paddingBottom: t.spacing.sm }}>
            <Txt variant="caption" tone="secondary">
              {tr('imports.tenant_description')}
            </Txt>
            {canUpload ? (
              <Button
                label={tr('mobile.uploads.new_import')}
                icon={<Plus size={18} color={t.colors.onPrimary} />}
                onPress={() => router.push('/imports/new')}
                style={{ marginTop: t.spacing.xs }}
              />
            ) : null}
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={80} />
          ) : list.isError ? (
            <ErrorState description={tr('imports.forbidden')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState icon={<Upload size={28} color={t.colors.textMuted} />} title={tr('imports.empty_title')} description={tr('imports.tenant_empty_description')} />
          )
        }
        renderItem={({ item: job }) => {
          const canRollback = job.status === 'applied' && rollbackWindowOpen(job.rollback_until, nowMs);
          return (
            <Card onPress={() => router.push(`/imports/${job.uuid}`)} style={{ gap: t.spacing.xs }} accessibilityLabel={formatResource(tr, 'imports', job.resource)}>
              <Row gap={t.spacing.sm}>
                <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {formatResource(tr, 'imports', job.resource)}
                </Txt>
                <Badge size="sm" tone={importStatusTone(job.status)} label={formatImportStatus(tr, job.status)} />
              </Row>
              <Row gap={t.spacing.md}>
                <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
                  {formatImportFormat(tr, job.format)}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {fmt.dateTime(job.created_at)}
                </Txt>
              </Row>
              {canRollback ? (
                <Button
                  size="sm"
                  variant="outline"
                  label={tr('imports.rollback')}
                  loading={rollback.isPending && rollback.variables === job.uuid}
                  disabled={rollback.isPending}
                  onPress={() => rollback.mutate(job.uuid)}
                  style={{ alignSelf: 'flex-start', marginTop: t.spacing.xs }}
                />
              ) : null}
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}
