/**
 * Contracts on the job detail screen (web `JobContractsSection`): the job's contracts with status,
 * signed/total and PDF download, plus "create contract" → optional vehicle photos → sign every
 * pending signer in the same sheet, without leaving the job.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Camera, Download, FilePlus2, ImagePlus, Users, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

import type { UploadFile } from '@/api/files';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, Card, Group, IconButton, KeyboardScroll, Row, Section, SelectField, Sheet, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

import { instanceStatusLabel, instanceStatusTone, useContractsAccess } from '../lib/access';
import { useMediaPicker } from '../lib/media-picker';
import { contractKeys, useActiveContractTemplates, useContractInstance } from '../queries';
import { contractsService, type ContractInstance, type ContractSigner } from '../services/contracts.service';
import { SignerForm } from './sign-sheet';

const log = createLogger('contracts.job-section');

type PhotoDraft = UploadFile & { id: string };

function nextPendingSigner(instance: ContractInstance): ContractSigner | null {
  const signers = instance.signers ?? [];
  return signers.find((s) => s.required && s.status !== 'signed') ?? signers.find((s) => s.status !== 'signed') ?? null;
}

export const jobContractsKey = (jobUuid: string) => [...contractKeys.instances, 'job', jobUuid] as const;

export function JobContractsSection({ jobUuid, canCreate = true }: { jobUuid: string; canCreate?: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const toast = useToast();
  const { canRead, canWrite } = useContractsAccess();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const list = useQuery({
    queryKey: jobContractsKey(jobUuid),
    queryFn: () => contractsService.listInstances({ subject_type: 'service_job', subject_uuid: jobUuid, limit: 50, offset: 0 }),
    enabled: canRead && Boolean(jobUuid),
  });

  if (!canRead) return null;
  const items = list.data?.items ?? [];
  const showCreate = canWrite && canCreate;

  const download = async (uuid: string) => {
    setDownloading(uuid);
    try {
      await contractsService.downloadPdf(uuid);
    } catch (error) {
      log.error('PDF download failed', { error });
      toast.error(tr('exports.toast.download_failed'));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Section title={`${tr('contracts.job.section')}${items.length ? ` (${items.length})` : ''}`} action={showCreate ? { label: tr('contracts.job.create'), onPress: () => setSheetOpen(true) } : undefined}>
      <Group>
        {list.isLoading ? (
          <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} />
        ) : items.length === 0 ? (
          <View style={{ padding: t.spacing.lg, gap: t.spacing.md, alignItems: 'center' }}>
            <Txt variant="caption" tone="secondary">
              {tr('contracts.job.empty')}
            </Txt>
            {showCreate ? (
              <Button size="sm" variant="outline" icon={<FilePlus2 size={16} color={t.colors.text} />} label={tr('contracts.job.create')} onPress={() => setSheetOpen(true)} />
            ) : null}
          </View>
        ) : (
          items.map((item, i) => {
            const signers = item.signers ?? [];
            const signed = signers.filter((s) => s.status === 'signed').length;
            const hasPdf = item.status === 'executed' && Boolean(item.pdf_url);
            return (
              <Pressable
                key={item.uuid}
                onPress={() => router.push(`/contracts/instances/${item.uuid}`)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                  padding: t.spacing.lg,
                  borderBottomWidth: i === items.length - 1 ? 0 : 1,
                  borderBottomColor: t.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" tone="primary" numberOfLines={2}>
                    {item.number_label ? `${item.number_label} · ` : ''}
                    {item.title}
                  </Txt>
                  <Row gap={t.spacing.sm}>
                    <Txt variant="caption" tone="secondary">
                      {fmt.dateTime(item.created_at)}
                    </Txt>
                    {signers.length > 0 ? (
                      <Row gap={3}>
                        <Users size={12} color={t.colors.textMuted} />
                        <Txt variant="caption" tone="secondary">{`${signed}/${signers.length}`}</Txt>
                      </Row>
                    ) : null}
                  </Row>
                </View>
                <Badge size="sm" tone={instanceStatusTone(item.status)} label={instanceStatusLabel(tr, item.status)} />
                {hasPdf ? (
                  <IconButton
                    variant="ghost"
                    label={tr('contracts.instances.download_pdf')}
                    disabled={downloading === item.uuid}
                    icon={downloading === item.uuid ? <ActivityIndicator size="small" color={t.colors.primary} /> : <Download size={18} color={t.colors.primary} />}
                    onPress={() => download(item.uuid)}
                  />
                ) : null}
              </Pressable>
            );
          })
        )}
      </Group>
      {showCreate ? <JobContractSheet visible={sheetOpen} jobUuid={jobUuid} onClose={() => setSheetOpen(false)} /> : null}
    </Section>
  );
}

function JobContractSheet({ visible, jobUuid, onClose }: { visible: boolean; jobUuid: string; onClose: () => void }) {
  const { t: tr } = useLocale();
  const [createdUuid, setCreatedUuid] = useState<string | null>(null);
  const close = () => {
    setCreatedUuid(null);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={close} title={createdUuid ? tr('contracts.job.sheet_sign_title') : tr('contracts.job.sheet_create_title')} scroll={false}>
      {visible ? createdUuid ? <SignStep instanceUuid={createdUuid} onClose={close} /> : <CreateStep jobUuid={jobUuid} onClose={close} onCreated={setCreatedUuid} /> : null}
    </Sheet>
  );
}

function CreateStep({ jobUuid, onClose, onCreated }: { jobUuid: string; onClose: () => void; onCreated: (uuid: string) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const picker = useMediaPicker({ photosOnly: true });
  const templates = useActiveContractTemplates();
  const [templateUuid, setTemplateUuid] = useState('');
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const addPhotos = async (pick: () => Promise<UploadFile[]>) => {
    const files = await pick();
    if (files.length) setPhotos((prev) => [...prev, ...files.map((f, i) => ({ ...f, id: `${f.uri}-${Date.now()}-${i}` }))]);
  };

  const create = useApiMutation({
    key: 'contracts.job.create',
    // Photos go on before the PDF is rendered: create deferred, upload, then finalize (web flow).
    fn: async () => {
      const instance = await contractsService.createInstance({ template_uuid: templateUuid, subject_type: 'service_job', subject_uuid: jobUuid, defer_execute: photos.length > 0 });
      if (photos.length === 0) return { instance, failed: [] as string[] };
      const failed: string[] = [];
      for (const [index, photo] of photos.entries()) {
        setProgress({ done: index, total: photos.length });
        try {
          await contractsService.uploadMedia(instance.uuid, { uri: photo.uri, name: photo.name, type: photo.type, size: photo.size });
        } catch (error) {
          log.warn('Photo upload failed', { name: photo.name, error });
          failed.push(photo.name);
        }
      }
      setProgress(null);
      // Renders the PDF now when nothing waits for a signature; otherwise the last signature does.
      const finalized = await contractsService.finalizeInstance(instance.uuid).catch(() => instance);
      return { instance: finalized, failed };
    },
    invalidate: [contractKeys.all],
    success: tr('contracts.instances.toast.created'),
    toastValidation: true,
    onSuccess: ({ instance, failed }) => {
      if (failed.length) toast.error(tr('contracts.job.photos_failed', { names: failed.join(', ') }));
      qc.setQueryData([...contractKeys.instances, 'detail', instance.uuid], instance);
      onCreated(instance.uuid);
    },
  });
  const busy = create.isPending;

  return (
    <KeyboardScroll contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }}>
      <Txt variant="caption" tone="secondary">
        {tr('contracts.job.sheet_create_description')}
      </Txt>
      <SelectField
        label={tr('contracts.instances.create_template')}
        required
        value={templateUuid || null}
        loading={templates.isLoading}
        searchable
        disabled={busy}
        placeholder={tr('contracts.instances.create_template')}
        options={(templates.data?.items ?? []).map((tpl) => ({ value: tpl.uuid, label: tpl.title, description: tpl.category || undefined }))}
        onChange={(v) => setTemplateUuid(v ?? '')}
      />
      <View style={{ gap: t.spacing.sm }}>
        <View style={{ gap: 2 }}>
          <Txt variant="label" tone="secondary">
            {tr('contracts.job.photos')}
          </Txt>
          <Txt variant="caption" tone="muted">
            {tr('contracts.job.photos_hint')}
          </Txt>
        </View>
        <Row gap={t.spacing.sm} wrap>
          <Button size="sm" variant="secondary" disabled={busy} icon={<Camera size={16} color={t.colors.primary} />} label={tr('contracts.job.photos_take')} onPress={() => addPhotos(picker.takePhoto)} />
          <Button size="sm" variant="secondary" disabled={busy} icon={<ImagePlus size={16} color={t.colors.primary} />} label={tr('contracts.job.photos_pick')} onPress={() => addPhotos(picker.pickPhotos)} />
        </Row>
        {photos.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {photos.map((photo) => (
              <View key={photo.id} style={{ width: '31%', aspectRatio: 1, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.colors.surfaceAlt }}>
                <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel={photo.name} />
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((p) => p.id !== photo.id))}
                  disabled={busy}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={tr('contracts.job.photos_remove')}
                  style={{ position: 'absolute', top: 4, right: 4, padding: 4, borderRadius: 999, backgroundColor: t.colors.surface }}
                >
                  <X size={14} color={t.colors.text} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {progress ? (
          <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
            {tr('contracts.job.photos_uploading', { done: String(progress.done + 1), total: String(progress.total) })}
          </Txt>
        ) : null}
      </View>
      <Button label={busy ? tr('common.saving') : tr('contracts.job.sheet_continue')} loading={busy} disabled={!templateUuid} onPress={() => create.mutate(undefined)} />
      <Button variant="outline" label={tr('common.cancel')} disabled={busy} onPress={onClose} />
    </KeyboardScroll>
  );
}

function SignStep({ instanceUuid, onClose }: { instanceUuid: string; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const query = useContractInstance(instanceUuid);
  const instance = query.data;
  if (!instance) return <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.xl }} />;
  const pending = nextPendingSigner(instance);

  if (!pending) {
    return (
      <View style={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
        <Card style={{ gap: 2 }}>
          <Txt variant="bodyStrong">{instance.title}</Txt>
          {instance.number_label ? (
            <Txt variant="caption" tone="secondary">
              {instance.number_label}
            </Txt>
          ) : null}
        </Card>
        <Txt tone="secondary">{tr('contracts.job.sheet_done')}</Txt>
        <Button label={tr('common.close')} onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, gap: 2 }}>
        <Txt variant="bodyStrong">{instance.title}</Txt>
        <Txt variant="caption" tone="secondary">
          {tr('contracts.job.sheet_sign_description')}
        </Txt>
      </View>
      <SignerForm
        key={pending.uuid}
        instance={instance}
        signer={pending}
        cancelLabel={tr('contracts.job.sheet_later')}
        onDone={onClose}
        onSigned={(updated) => {
          qc.setQueryData([...contractKeys.instances, 'detail', updated.uuid], updated);
          if (!nextPendingSigner(updated)) onClose();
        }}
      />
    </View>
  );
}
