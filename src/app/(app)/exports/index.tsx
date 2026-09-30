import { router } from 'expo-router';
import { Download, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, DateField, EmptyState, ErrorState, Header, IconButton, ListSkeleton, Row, SelectField, Sheet, TextField, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { exportStatusTone, formatExportFormat, formatExportStatus, formatResource, isExportRunning } from '@/features/io/lib/display';
import { EXPORT_FORMATS, exportPath, TENANT_EXPORTS } from '@/features/io/lib/export-resources';
import { IO_POLL_MS, ioKeys, useExportJobsInfinite } from '@/features/io/queries';
import { exportsService } from '@/features/io/services/exports.service';
import type { ExportFormat, IoResource } from '@/features/io/types';
import { useShareExport } from '@/features/io/use-share-export';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function ExportsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeExport} title={tr('exports.title')}>
      <ExportsList />
    </RequirePermission>
  );
}

function ExportsList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { can } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const list = useExportJobsInfinite();
  const { share, busy } = useShareExport();
  const running = list.items.some((j) => isExportRunning(j.status));
  const { refetch } = list;
  const canCreate = TENANT_EXPORTS.some((r) => can(r.perm));

  // Poll while the worker is still producing a file (web relies on notifications; mobile polls).
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => refetch(), IO_POLL_MS);
    return () => clearInterval(id);
  }, [running, refetch]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('exports.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : undefined}
        right={
          canCreate ? (
            <IconButton variant="primary" label={tr('mobile.documents.new_export')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => setCreateOpen(true)} />
          ) : undefined
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(j) => j.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <Txt variant="caption" tone="secondary" style={{ paddingBottom: t.spacing.sm }}>
            {tr('exports.tenant_description')}
          </Txt>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={80} />
          ) : list.isError ? (
            <ErrorState description={tr('exports.forbidden')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<Download size={28} color={t.colors.textMuted} />}
              title={tr('exports.empty_title')}
              description={tr('exports.tenant_empty_description')}
              action={canCreate ? <Button label={tr('mobile.documents.new_export')} onPress={() => setCreateOpen(true)} /> : undefined}
            />
          )
        }
        renderItem={({ item: job }) => (
          <Card onPress={() => router.push(`/exports/${job.uuid}`)} style={{ gap: t.spacing.xs }} accessibilityLabel={formatResource(tr, 'exports', job.resource)}>
            <Row gap={t.spacing.sm}>
              <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {formatResource(tr, 'exports', job.resource)}
              </Txt>
              <Badge size="sm" tone={exportStatusTone(job.status)} label={formatExportStatus(tr, job.status)} />
            </Row>
            <Row gap={t.spacing.md}>
              <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
                {`${formatExportFormat(tr, job.format)} · ${tr('exports.columns.rows')}: ${job.row_count}`}
              </Txt>
              <Txt variant="caption" tone="muted">
                {fmt.dateTime(job.created_at)}
              </Txt>
            </Row>
            {job.status === 'completed' ? (
              <Button
                size="sm"
                variant="outline"
                label={tr('exports.download')}
                loading={busy === job.uuid}
                icon={<Download size={16} color={t.colors.text} />}
                onPress={() => share(job)}
                style={{ alignSelf: 'flex-start', marginTop: t.spacing.xs }}
              />
            ) : null}
          </Card>
        )}
      />
      <NewExportSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </SafeAreaView>
  );
}

/** Mobile entry point for the web `ExportMenu`: pick a resource, format and optional list filters. */
function NewExportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('mobile.documents.new_export')}>
      {visible ? <NewExportBody onClose={onClose} /> : null}
    </Sheet>
  );
}

function NewExportBody({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const { can } = useAuth();
  const allowed = useMemo(() => TENANT_EXPORTS.filter((r) => can(r.perm)), [can]);
  const [resource, setResource] = useState<IoResource | null>(allowed[0]?.resource ?? null);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const def = allowed.find((r) => r.resource === resource);

  const create = useApiMutation({
    key: 'exports.request',
    fn: () => {
      const query: Record<string, string> = {};
      if (def?.filters.includes('q') && q.trim()) query.q = q.trim();
      if (def?.filters.includes('dates')) {
        if (dateFrom) query.date_from = dateFrom;
        if (dateTo) query.date_to = dateTo;
      }
      return exportsService.request(exportPath(resource!), { format, query, locale });
    },
    invalidate: [ioKeys.exports],
    success: tr('exports.toast.queued'),
    toastValidation: true,
    onSuccess: (job) => {
      onClose();
      router.push(`/exports/${job.uuid}`);
    },
  });

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt variant="caption" tone="secondary">
        {tr('exports.menu_hint')}
      </Txt>
      <SelectField
        label={tr('exports.columns.resource')}
        required
        value={resource}
        options={allowed.map((r) => ({ value: r.resource, label: formatResource(tr, 'exports', r.resource) }))}
        onChange={(v) => setResource((v as IoResource | null) ?? null)}
      />
      <SelectField
        label={tr('exports.columns.format')}
        required
        value={format}
        options={EXPORT_FORMATS.map((f) => ({ value: f, label: tr(`exports.formats.${f}`) }))}
        onChange={(v) => v && setFormat(v as ExportFormat)}
      />
      {def?.filters.includes('q') ? <TextField label={tr('common.search')} hint={tr('mobile.common.optional')} value={q} onChangeText={setQ} /> : null}
      {def?.filters.includes('dates') ? (
        <Row gap={t.spacing.md}>
          <View style={{ flex: 1 }}>
            <DateField label={tr('mobile.documents.date_from')} value={dateFrom} onChange={setDateFrom} allowClear />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={tr('mobile.documents.date_to')} value={dateTo} onChange={setDateTo} allowClear />
          </View>
        </Row>
      ) : null}
      <Button label={tr('exports.menu_label')} loading={create.isPending} disabled={!resource} onPress={() => create.mutate(undefined)} />
      <Button variant="outline" label={tr('common.cancel')} onPress={onClose} />
    </View>
  );
}
