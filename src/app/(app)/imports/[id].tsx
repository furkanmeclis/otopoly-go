import { useLocalSearchParams } from 'expo-router';
import { Undo2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, ErrorState, Header, InfoRow, ListSkeleton, Row, Screen, Section, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { apiMappingToUi, formatImportFormat, formatImportStatus, formatResource, importStatusTone, rollbackWindowOpen } from '@/features/io/lib/display';
import { IMPORTS_GATE } from '@/features/io/lib/gates';
import { ioKeys, useImportJob } from '@/features/io/queries';
import { importsService } from '@/features/io/services/imports.service';
import { IMPORT_SCHEMA, type IoResource } from '@/features/io/types';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function ImportDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={IMPORTS_GATE} title={tr('imports.detail.title')}>
      <ImportDetail />
    </RequirePermission>
  );
}

function ImportDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useImportJob(id);
  const [nowMs] = useState(() => Date.now());
  const job = query.data;

  const rollback = useApiMutation({
    key: 'imports.rollback',
    fn: () => importsService.rollback(id),
    invalidate: [ioKeys.imports],
    success: tr('imports.toast.rollback_success'),
    toastValidation: true,
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('imports.detail.title')} />}>
        <ListSkeleton rows={3} height={90} />
      </Screen>
    );
  }
  if (query.isError || !job) {
    return (
      <Screen header={<Header title={tr('imports.detail.title')} />}>
        <ErrorState description={tr('imports.detail.not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const resourceName = formatResource(tr, 'imports', job.resource);
  const format = formatImportFormat(tr, job.format);
  const canRollback = job.status === 'applied' && rollbackWindowOpen(job.rollback_until, nowMs);
  const uiMapping = apiMappingToUi(job.mapping);
  const schema = IMPORT_SCHEMA[job.resource as IoResource] ?? [];
  const preview = job.preview_summary;
  const defaults = Object.entries(job.defaults ?? {});

  return (
    <Screen
      header={<Header title={resourceName} subtitle={tr('imports.detail.title_with_resource', { resource: resourceName, format })} />}
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <Badge tone={importStatusTone(job.status)} label={formatImportStatus(tr, job.status)} />
      <Txt variant="caption" tone="secondary">
        {tr('imports.detail.description')}
      </Txt>

      <Section title={tr('imports.detail.summary')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('imports.detail.fields.uuid')}>
            <Txt variant="caption" selectable style={{ flexShrink: 1, textAlign: 'right' }}>
              {job.uuid}
            </Txt>
          </InfoRow>
          <InfoRow label={tr('imports.columns.resource')} value={resourceName} />
          <InfoRow label={tr('imports.columns.format')} value={format} />
          <InfoRow label={tr('imports.columns.status')} value={formatImportStatus(tr, job.status)} />
          <InfoRow label={tr('imports.columns.created_at')} value={fmt.dateTime(job.created_at)} />
          <InfoRow label={tr('imports.detail.fields.applied_at')} value={job.applied_at ? fmt.dateTime(job.applied_at) : '—'} />
          <InfoRow label={tr('imports.detail.fields.rollback_until')} value={job.rollback_until ? fmt.dateTime(job.rollback_until) : '—'} last />
        </Card>
      </Section>

      {schema.length > 0 ? (
        <Section title={tr('imports.detail.mapping_section')}>
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
            <Row gap={t.spacing.md} style={{ paddingVertical: t.spacing.sm, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
              <Txt variant="label" tone="muted" style={{ flex: 1 }}>
                {tr('imports.detail.mapping_target')}
              </Txt>
              <Txt variant="label" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
                {tr('imports.detail.mapping_source')}
              </Txt>
            </Row>
            {schema.map((field, i) => (
              <InfoRow key={field.key} label={`${tr(field.labelKey)}${field.required ? ' *' : ''}`} last={i === schema.length - 1}>
                {uiMapping[field.key] ? (
                  <Txt variant="bodyStrong" style={{ flexShrink: 1, textAlign: 'right' }}>
                    {uiMapping[field.key]}
                  </Txt>
                ) : (
                  <Txt variant="caption" tone="muted" style={{ flexShrink: 1, textAlign: 'right' }}>
                    {tr('imports.mapping_skip')}
                  </Txt>
                )}
              </InfoRow>
            ))}
          </Card>
        </Section>
      ) : null}

      {defaults.length > 0 ? (
        <Section title={tr('imports.detail.defaults_section')}>
          <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
            {defaults.map(([key, value], i) => {
              const field = schema.find((f) => f.key === key);
              return <InfoRow key={key} label={field ? tr(field.labelKey) : key} value={value} last={i === defaults.length - 1} />;
            })}
          </Card>
        </Section>
      ) : null}

      {preview ? (
        <Section title={tr('imports.detail.preview_section')}>
          <Row gap={t.spacing.sm}>
            {[
              { label: tr('imports.preview_total'), value: preview.total, tone: 'default' as const },
              { label: tr('imports.preview_valid'), value: preview.valid, tone: 'success' as const },
              { label: tr('imports.preview_invalid'), value: preview.invalid, tone: 'danger' as const },
            ].map((s) => (
              <Card key={s.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Txt variant="mono" tone={s.tone}>
                  {s.value}
                </Txt>
                <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                  {s.label}
                </Txt>
              </Card>
            ))}
          </Row>
          {(preview.errors?.length ?? 0) > 0 ? (
            <Card style={{ gap: t.spacing.xs }}>
              {preview.errors!.map((err) => (
                <Txt key={`${err.index}-${err.field ?? ''}-${err.error}`} variant="caption" tone="danger">
                  {`• ${tr('imports.preview_row_error', { row: err.index, error: err.error })}`}
                </Txt>
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}

      {job.error ? (
        <Section title={tr('imports.detail.error_section')}>
          <Card>
            <Txt tone="danger" selectable>
              {job.error}
            </Txt>
          </Card>
        </Section>
      ) : null}

      {canRollback ? (
        <Section title={tr('imports.detail.rollback_section')}>
          <View style={{ gap: t.spacing.sm }}>
            <Txt variant="caption" tone="secondary">
              {tr('imports.rollback_hint')}
            </Txt>
            <Button
              variant="outline"
              label={tr('imports.rollback')}
              loading={rollback.isPending}
              icon={<Undo2 size={18} color={t.colors.text} />}
              onPress={() => rollback.mutate(undefined)}
            />
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}
