/**
 * Import wizard (web `ImportWizard`): upload → column mapping → defaults → preview → confirm.
 * `?resource=` preselects the resource; `?uuid=` resumes a job that was uploaded but not confirmed.
 */
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Download, FileSpreadsheet, Sparkles } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { UploadFile } from '@/api/files';
import { Badge, Button, Card, ErrorState, FilterChips, Header, ListSkeleton, Row, Screen, Section, SelectField, TextField, Txt } from '@/components/ui';
import { useToast } from '@/components/feedback/toast';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { apiMappingToUi, formatResource } from '@/features/io/lib/display';
import { IMPORTS_GATE } from '@/features/io/lib/gates';
import { formatFromFileName, IMPORT_FORMATS, IMPORT_MAX_BYTES, importMimeTypes, readFileHeaders, TENANT_IMPORTS } from '@/features/io/lib/import-resources';
import { countMappedFields, hasDuplicateHeader, MAPPING_SKIP, suggestColumnMapping, uiMappingToApi } from '@/features/io/lib/suggest-mapping';
import { ioKeys, useImportJob } from '@/features/io/queries';
import { importsService } from '@/features/io/services/imports.service';
import { IMPORT_PATHS, IMPORT_SCHEMA, type ImportFormat, type ImportJob, type IoResource } from '@/features/io/types';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.imports.new');

type Step = 'upload' | 'mapping' | 'defaults' | 'preview' | 'done';
const STEPS: Step[] = ['upload', 'mapping', 'defaults', 'preview', 'done'];
const PREVIEW_ERRORS_SHOWN = 10;

export default function NewImportScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={IMPORTS_GATE} title={tr('imports.wizard_title')}>
      <ImportWizardGate />
    </RequirePermission>
  );
}

function ImportWizardGate() {
  const { t: tr } = useLocale();
  const { uuid } = useLocalSearchParams<{ uuid?: string }>();
  const resumed = useImportJob(uuid ?? '');
  if (!uuid) return <ImportWizard />;
  if (resumed.isLoading) {
    return (
      <Screen header={<Header title={tr('imports.wizard_title')} />}>
        <ListSkeleton rows={3} height={80} />
      </Screen>
    );
  }
  if (resumed.isError || !resumed.data) {
    return (
      <Screen header={<Header title={tr('imports.wizard_title')} />}>
        <ErrorState error={resumed.error} description={tr('imports.detail.not_found')} onRetry={() => resumed.refetch()} />
      </Screen>
    );
  }
  return <ImportWizard resumeJob={resumed.data} />;
}

function StepIndicator({ step }: { step: Step }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const active = STEPS.indexOf(step);
  return (
    <Row gap={t.spacing.xs} wrap>
      {STEPS.map((s, i) => (
        <View
          key={s}
          accessibilityState={{ selected: i === active }}
          style={{
            paddingHorizontal: t.spacing.sm,
            paddingVertical: 3,
            borderRadius: t.radius.full,
            borderWidth: 1,
            borderStyle: i > active ? 'dashed' : 'solid',
            borderColor: i === active ? t.colors.primary : t.colors.border,
            backgroundColor: i === active ? t.colors.primarySoft : 'transparent',
          }}
        >
          <Txt variant="caption" tone={i === active ? 'primary' : i < active ? 'secondary' : 'muted'} style={i === active ? { fontWeight: '600' } : undefined}>
            {tr(`imports.step.${s}`)}
          </Txt>
        </View>
      ))}
    </Row>
  );
}

function ImportWizard({ resumeJob }: { resumeJob?: ImportJob }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const toast = useToast();
  const { can } = useAuth();
  const params = useLocalSearchParams<{ resource?: string }>();
  const options = TENANT_IMPORTS.filter((r) => can(r.perm));

  const initialResource = (resumeJob?.resource ?? options.find((o) => o.resource === params.resource)?.resource ?? options[0]?.resource ?? null) as IoResource | null;
  const [resource, setResource] = useState<IoResource | null>(initialResource);
  // A resumed job opens at the step it stopped at (a previewed one shows its stored summary).
  const [step, setStep] = useState<Step>(resumeJob ? (resumeJob.status === 'previewed' && resumeJob.preview_summary ? 'preview' : 'mapping') : 'upload');
  const [format, setFormat] = useState<ImportFormat>((resumeJob?.format as ImportFormat) ?? 'xlsx');
  const [file, setFile] = useState<UploadFile | null>(null);
  const [job, setJob] = useState<ImportJob | null>(resumeJob ?? null);
  const [headers, setHeaders] = useState<string[]>(() => Object.keys(resumeJob?.mapping ?? {}));
  const [mapping, setMapping] = useState<Record<string, string>>(() => apiMappingToUi(resumeJob?.mapping));
  const [defaults, setDefaults] = useState<Record<string, string>>(() => ({ ...(resumeJob?.defaults ?? {}) }));
  const [mappingError, setMappingError] = useState<string | null>(null);

  const schema = useMemo(() => (resource ? (IMPORT_SCHEMA[resource] ?? []) : []), [resource]);
  const paths = resource ? IMPORT_PATHS[resource] : undefined;
  const isMapped = (key: string) => Boolean(mapping[key] && mapping[key] !== MAPPING_SKIP);
  const requiredDefaults = schema.filter((f) => f.required && !isMapped(f.key) && !defaults[f.key]?.trim());
  const mappedCount = countMappedFields(mapping);

  const autoMatch = (headerList: string[]) => suggestColumnMapping(headerList, schema, (k) => tr(k));

  const upload = useApiMutation({
    key: 'imports.upload',
    fn: async () => {
      if (!file || !paths) throw new Error('no file');
      const created = await importsService.upload(paths.upload, file, format, locale);
      const detected = await readFileHeaders(file.uri, format);
      return { created, detected };
    },
    invalidate: [ioKeys.imports],
    onSuccess: ({ created, detected }) => {
      log.info('Import uploaded', { uuid: created.uuid, resource: created.resource, detected: detected.length });
      const serverMapping = apiMappingToUi(created.mapping);
      const ui = detected.length ? { ...autoMatch(detected), ...serverMapping } : serverMapping;
      setHeaders(detected.length ? detected : Object.keys(created.mapping ?? {}));
      setMapping(ui);
      setDefaults({});
      setJob(created);
      const matched = countMappedFields(ui);
      if (matched > 0) toast.success(tr('imports.toast.auto_mapped', { count: matched }));
      else if (format === 'xlsx' && !detected.length) toast.info(tr('imports.mapping_none'));
      setStep('mapping');
    },
  });

  const saveMapping = useApiMutation({
    key: 'imports.mapping',
    fn: (next: Step) => importsService.updateMapping(job!.uuid, { mapping: uiMappingToApi(mapping), defaults }, 'tenant').then((updated) => ({ updated, next })),
    toastValidation: true,
    onSuccess: ({ updated, next }) => {
      setJob(updated);
      setStep(next);
      if (next === 'preview') preview.mutate(updated.uuid);
    },
  });

  const preview = useApiMutation({
    key: 'imports.preview',
    fn: (uuid: string) => importsService.preview(uuid, 'tenant'),
    toastValidation: true,
    onSuccess: (updated) => setJob(updated),
  });

  const confirm = useApiMutation({
    key: 'imports.confirm',
    fn: () => importsService.confirm(job!.uuid, 'tenant'),
    invalidate: [ioKeys.imports],
    success: tr('imports.toast.confirmed'),
    toastValidation: true,
    onSuccess: (confirmed) => {
      setJob(confirmed);
      setStep('done');
    },
  });

  const [sampleBusy, setSampleBusy] = useState<ImportFormat | null>(null);
  const downloadSample = async (f: ImportFormat) => {
    if (!paths) return;
    setSampleBusy(f);
    try {
      await importsService.downloadSample(paths.sample, f, locale);
    } catch (error) {
      log.warn('Sample download failed', { error });
      toast.error(tr('imports.toast.sample_failed'));
    } finally {
      setSampleBusy(null);
    }
  };

  const pickFile = async () => {
    try {
      // Pick any supported type; the format chip follows the file extension.
      const types = Array.from(new Set(IMPORT_FORMATS.flatMap(importMimeTypes)));
      const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > IMPORT_MAX_BYTES) {
        toast.error(tr('mobile.uploads.file_too_large', { name: asset.name, size: 10 }));
        return;
      }
      const detected = formatFromFileName(asset.name);
      if (detected) setFormat(detected);
      setFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream', size: asset.size });
    } catch (error) {
      log.error('Document picker failed', { error });
      toast.error(tr('mobile.uploads.picker_failed'));
    }
  };

  const goMapping = () => {
    if (hasDuplicateHeader(mapping)) {
      setMappingError(tr('imports.mapping_duplicate'));
      return;
    }
    setMappingError(null);
    saveMapping.mutate('defaults');
  };

  if (!resource || options.length === 0) {
    return (
      <Screen header={<Header title={tr('imports.wizard_title')} />}>
        <Txt tone="secondary">{tr('mobile.uploads.import_no_resources')}</Txt>
      </Screen>
    );
  }

  const summary = job?.preview_summary;
  const busy = upload.isPending || saveMapping.isPending || preview.isPending || confirm.isPending;
  const headerOptions = [{ value: MAPPING_SKIP, label: tr('imports.mapping_skip') }, ...headers.map((h) => ({ value: h, label: h }))];

  const footer =
    step === 'upload' ? (
      <Button label={tr('imports.next')} loading={upload.isPending} disabled={!file} onPress={() => upload.mutate(undefined)} />
    ) : step === 'mapping' ? (
      <Row gap={t.spacing.sm}>
        <Button variant="outline" label={tr('imports.back')} disabled={busy || Boolean(resumeJob)} onPress={() => setStep('upload')} style={{ flex: 1 }} />
        <Button label={tr('imports.next')} loading={saveMapping.isPending} disabled={busy} onPress={goMapping} style={{ flex: 1 }} />
      </Row>
    ) : step === 'defaults' ? (
      <Row gap={t.spacing.sm}>
        <Button variant="outline" label={tr('imports.back')} disabled={busy} onPress={() => setStep('mapping')} style={{ flex: 1 }} />
        <Button
          label={tr('imports.preview_action')}
          loading={saveMapping.isPending}
          disabled={busy || requiredDefaults.length > 0}
          onPress={() => saveMapping.mutate('preview')}
          style={{ flex: 1 }}
        />
      </Row>
    ) : step === 'preview' ? (
      <Row gap={t.spacing.sm}>
        <Button variant="outline" label={tr('imports.back')} disabled={busy} onPress={() => setStep('defaults')} style={{ flex: 1 }} />
        <Button label={tr('imports.confirm')} loading={confirm.isPending} disabled={busy || !summary} onPress={() => confirm.mutate(undefined)} style={{ flex: 1 }} />
      </Row>
    ) : (
      <Button label={tr('common.close')} onPress={() => router.back()} />
    );

  return (
    <Screen header={<Header title={tr('imports.wizard_title')} subtitle={formatResource(tr, 'imports', resource)} />} footer={footer}>
      <Txt variant="caption" tone="secondary">
        {tr('imports.wizard_description')}
      </Txt>
      <StepIndicator step={step} />

      {step === 'upload' ? (
        <>
          <SelectField
            label={tr('imports.columns.resource')}
            required
            value={resource}
            options={options.map((o) => ({ value: o.resource, label: formatResource(tr, 'imports', o.resource) }))}
            onChange={(v) => v && setResource(v as IoResource)}
          />
          <View style={{ gap: t.spacing.xs }}>
            <Txt variant="label" tone="secondary">
              {tr('imports.format')}
            </Txt>
            <FilterChips options={IMPORT_FORMATS.map((f) => ({ value: f, label: tr(`imports.formats.${f}`) }))} value={format} onChange={setFormat} />
            <Txt variant="caption" tone="muted">
              {tr('imports.format_hint')}
            </Txt>
          </View>
          <View style={{ gap: t.spacing.xs }}>
            <Txt variant="label" tone="secondary">
              {tr('imports.file')}
            </Txt>
            <Card onPress={pickFile} accessibilityLabel={file ? file.name : tr('mobile.uploads.choose_file')} style={{ gap: t.spacing.xs, alignItems: 'center', borderStyle: 'dashed' }}>
              <FileSpreadsheet size={28} color={file ? t.colors.primary : t.colors.textMuted} />
              <Txt variant="bodyStrong" numberOfLines={2} style={{ textAlign: 'center' }}>
                {file ? file.name : tr('mobile.uploads.choose_file')}
              </Txt>
              <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                {file ? tr('mobile.uploads.change_file') : tr('imports.file_hint')}
              </Txt>
            </Card>
          </View>
          <Section title={tr('imports.samples_title')}>
            <Row gap={t.spacing.sm} wrap>
              {IMPORT_FORMATS.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant="outline"
                  loading={sampleBusy === f}
                  disabled={sampleBusy !== null}
                  icon={<Download size={14} color={t.colors.text} />}
                  label={tr('imports.download_sample', { format: tr(`imports.formats.${f}`) })}
                  onPress={() => downloadSample(f)}
                />
              ))}
            </Row>
          </Section>
        </>
      ) : null}

      {step === 'mapping' ? (
        <>
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">{tr('imports.mapping_title')}</Txt>
              <Txt variant="caption" tone="secondary">
                {tr('imports.mapping_hint')}
              </Txt>
            </View>
            <Button
              size="sm"
              variant="secondary"
              icon={<Sparkles size={14} color={t.colors.primary} />}
              label={tr('imports.mapping_auto')}
              disabled={headers.length === 0}
              onPress={() => {
                const suggested = autoMatch(headers);
                const count = countMappedFields(suggested);
                setMapping(suggested);
                if (count === 0) toast.info(tr('imports.mapping_none'));
                else toast.success(tr('imports.toast.auto_mapped', { count }));
              }}
            />
          </Row>
          {mappedCount > 0 ? (
            <Txt variant="caption" tone="muted">
              {tr('imports.mapping_matched', { count: mappedCount })}
            </Txt>
          ) : null}
          {headers.length === 0 ? (
            <Txt variant="caption" tone="warning">
              {tr('imports.mapping_none')}
            </Txt>
          ) : null}
          {mappingError ? <Txt tone="danger">{mappingError}</Txt> : null}
          {schema.map((field) => (
            <SelectField
              key={field.key}
              label={tr(field.labelKey)}
              required={field.required}
              value={mapping[field.key] ?? MAPPING_SKIP}
              options={headerOptions}
              onChange={(v) => {
                setMappingError(null);
                setMapping((prev) => ({ ...prev, [field.key]: v ?? MAPPING_SKIP }));
              }}
            />
          ))}
          <Txt variant="caption" tone="muted">
            {tr('imports.mapping_auto_hint')}
          </Txt>
        </>
      ) : null}

      {step === 'defaults' ? (
        <>
          <View style={{ gap: 2 }}>
            <Txt variant="bodyStrong">{tr('imports.defaults_title')}</Txt>
            <Txt variant="caption" tone="secondary">
              {tr('imports.defaults_hint')}
            </Txt>
          </View>
          {schema.map((field) => {
            const mapped = isMapped(field.key);
            return (
              <TextField
                key={field.key}
                label={tr(field.labelKey)}
                required={field.required && !mapped}
                value={mapped ? '' : (defaults[field.key] ?? '')}
                editable={!mapped}
                placeholder={mapped ? tr('imports.defaults_mapped') : tr('imports.defaults_optional')}
                onChangeText={(v) => setDefaults((prev) => ({ ...prev, [field.key]: v }))}
                autoCapitalize="none"
              />
            );
          })}
          {requiredDefaults.length > 0 ? <Txt tone="danger">{tr('imports.defaults_required', { count: requiredDefaults.length })}</Txt> : null}
        </>
      ) : null}

      {step === 'preview' ? (
        <>
          <View style={{ gap: 2 }}>
            <Txt variant="bodyStrong">{tr('imports.preview_title')}</Txt>
            <Txt variant="caption" tone="secondary">
              {tr('imports.preview_hint')}
            </Txt>
          </View>
          {!summary ? (
            preview.isError ? (
              <ErrorState error={preview.error} description={tr('imports.toast.preview_failed')} onRetry={() => job && preview.mutate(job.uuid)} />
            ) : (
              <ListSkeleton rows={1} height={72} />
            )
          ) : (
            <>
              <Row gap={t.spacing.sm}>
                {[
                  { label: tr('imports.preview_total'), value: summary.total, tone: 'default' as const },
                  { label: tr('imports.preview_valid'), value: summary.valid, tone: 'success' as const },
                  { label: tr('imports.preview_invalid'), value: summary.invalid, tone: 'danger' as const },
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
              {(summary.errors?.length ?? 0) > 0 ? (
                <Card style={{ gap: t.spacing.xs }}>
                  {summary.errors!.slice(0, PREVIEW_ERRORS_SHOWN).map((err) => (
                    <Txt key={`${err.index}-${err.field ?? ''}-${err.error}`} variant="caption" tone="danger">
                      {`• ${tr('imports.preview_row_error', { row: err.index, error: err.error })}`}
                    </Txt>
                  ))}
                  {summary.errors!.length > PREVIEW_ERRORS_SHOWN ? (
                    <Txt variant="caption" tone="muted">
                      {tr('imports.preview_more_errors', { count: summary.errors!.length - PREVIEW_ERRORS_SHOWN })}
                    </Txt>
                  ) : null}
                </Card>
              ) : null}
              <Txt variant="caption" tone="muted">
                {tr('imports.confirm_hint')}
              </Txt>
            </>
          )}
        </>
      ) : null}

      {step === 'done' && job ? (
        <Card style={{ gap: t.spacing.sm, alignItems: 'center' }}>
          <CheckCircle2 size={36} color={t.colors.success} />
          <Txt variant="heading">{tr('imports.done_title')}</Txt>
          <Txt tone="secondary" style={{ textAlign: 'center' }}>
            {tr('imports.done_message')}
          </Txt>
          <Badge tone="info" label={formatResource(tr, 'imports', job.resource)} />
          <Button variant="outline" size="sm" label={tr('imports.view_jobs')} onPress={() => router.replace(`/imports/${job.uuid}`)} />
        </Card>
      ) : null}
    </Screen>
  );
}
