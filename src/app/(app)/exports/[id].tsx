import { useLocalSearchParams } from 'expo-router';
import { Download } from 'lucide-react-native';
import { ActivityIndicator } from 'react-native';

import { Badge, Button, Card, ErrorState, Header, InfoRow, ListSkeleton, Row, Screen, Section, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { exportDownloadFilename, exportStatusTone, formatExportFormat, formatExportStatus, formatResource, isExportRunning } from '@/features/io/lib/display';
import { useExportJob } from '@/features/io/queries';
import { useShareExport } from '@/features/io/use-share-export';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function ExportDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeExport} title={tr('exports.detail.title')}>
      <ExportDetail />
    </RequirePermission>
  );
}

function ExportDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useExportJob(id);
  const { share, busy } = useShareExport();
  const job = query.data;

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('exports.detail.title')} />}>
        <ListSkeleton rows={3} height={90} />
      </Screen>
    );
  }
  if (query.isError || !job) {
    return (
      <Screen header={<Header title={tr('exports.detail.title')} />}>
        <ErrorState description={tr('exports.detail.not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const resourceName = formatResource(tr, 'exports', job.resource);
  const format = formatExportFormat(tr, job.format);
  const filename = exportDownloadFilename(job.resource, job.format, new Date(job.created_at));

  return (
    <Screen
      header={<Header title={resourceName} subtitle={tr('exports.detail.title_with_resource', { resource: resourceName, format })} />}
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <Row gap={t.spacing.sm}>
        <Badge tone={exportStatusTone(job.status)} label={formatExportStatus(tr, job.status)} />
        {isExportRunning(job.status) ? <ActivityIndicator size="small" color={t.colors.primary} /> : null}
      </Row>
      <Txt variant="caption" tone="secondary">
        {tr('exports.detail.description')}
      </Txt>

      <Section title={tr('exports.detail.summary')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('exports.detail.fields.uuid')}>
            <Txt variant="caption" selectable style={{ flexShrink: 1, textAlign: 'right' }}>
              {job.uuid}
            </Txt>
          </InfoRow>
          <InfoRow label={tr('exports.columns.resource')} value={resourceName} />
          <InfoRow label={tr('exports.columns.format')} value={format} />
          <InfoRow label={tr('exports.columns.status')} value={formatExportStatus(tr, job.status)} />
          <InfoRow label={tr('exports.columns.rows')} value={String(job.row_count)} />
          <InfoRow label={tr('exports.columns.created_at')} value={fmt.dateTime(job.created_at)} />
          <InfoRow label={tr('exports.detail.fields.filename')} value={filename} last />
        </Card>
      </Section>

      {job.error ? (
        <Section title={tr('exports.detail.error_section')}>
          <Card>
            <Txt tone="danger" selectable>
              {job.error}
            </Txt>
          </Card>
        </Section>
      ) : null}

      {job.status === 'completed' ? (
        <Section title={tr('exports.detail.download_section')}>
          <Txt variant="caption" tone="secondary">
            {tr('mobile.documents.export_share_hint')}
          </Txt>
          <Button label={tr('exports.download')} loading={busy === job.uuid} icon={<Download size={18} color={t.colors.onPrimary} />} onPress={() => share(job)} />
        </Section>
      ) : null}
    </Screen>
  );
}
