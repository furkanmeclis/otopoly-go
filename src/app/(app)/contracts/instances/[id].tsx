import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Download, FileText, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Image, View } from 'react-native';

import { apiUrl } from '@/api/files';
import { Badge, Button, Card, ErrorState, Group, Header, IconButton, ListSkeleton, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useToast } from '@/components/feedback/toast';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ContractHtml } from '@/features/contracts/components/contract-html';
import { SignSheet } from '@/features/contracts/components/sign-sheet';
import { instanceStatusLabel, instanceStatusTone, signerStatusLabel, useContractsAccess } from '@/features/contracts/lib/access';
import { contractKeys, useContractInstance } from '@/features/contracts/queries';
import { contractsService } from '@/features/contracts/services/contracts.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.contracts.instance');

export default function ContractInstanceScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.contractsRead} title={tr('contracts.instances.detail')}>
      <ContractInstanceDetail />
    </RequirePermission>
  );
}

function ContractInstanceDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canWrite, canManage } = useContractsAccess();
  const confirm = useConfirm();
  const toast = useToast();
  const query = useContractInstance(id);
  const instance = query.data;
  const [signing, setSigning] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const voidInstance = useApiMutation({
    key: 'contracts.instances.void',
    fn: () => contractsService.voidInstance(id),
    invalidate: [contractKeys.all],
    success: tr('contracts.instances.toast.voided'),
    toastValidation: true,
  });
  const finalize = useApiMutation({
    key: 'contracts.instances.finalize',
    fn: () => contractsService.finalizeInstance(id),
    invalidate: [contractKeys.all],
    success: tr('mobile.documents.finalized'),
    toastValidation: true,
  });
  const deleteMedia = useApiMutation({
    key: 'contracts.instances.media.delete',
    fn: (mediaUuid: string) => contractsService.deleteMedia(id, mediaUuid),
    invalidate: [contractKeys.all],
    success: tr('contracts.instances.toast.media_deleted'),
    toastValidation: true,
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('contracts.instances.detail')} />}>
        <ListSkeleton rows={4} height={110} />
      </Screen>
    );
  }
  if (query.isError || !instance) {
    return (
      <Screen header={<Header title={tr('contracts.instances.detail')} />}>
        <ErrorState description={tr('contracts.instances.error_description')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const open = instance.status !== 'voided' && instance.status !== 'executed';
  const canMutate = canWrite && open;
  const signers = instance.signers ?? [];
  const media = instance.media ?? [];
  // Deferred no-signature contracts stay pending until finalized (backend `defer_execute`).
  const canFinalize = canWrite && instance.status === 'pending' && !instance.signature_required;

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      await contractsService.downloadPdf(instance.uuid);
    } catch (error) {
      log.error('PDF download failed', { error });
      toast.error(tr('exports.toast.download_failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Screen
      header={<Header title={instance.title} subtitle={instance.number_label ? `${tr('contracts.fields.number')}: ${instance.number_label}` : instance.subject_type} />}
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <Card style={{ gap: t.spacing.sm }}>
        <Row gap={t.spacing.sm}>
          <Badge tone={instanceStatusTone(instance.status)} label={instanceStatusLabel(tr, instance.status)} />
          <View style={{ flex: 1 }} />
          <Txt variant="caption" tone="secondary">
            {fmt.dateTime(instance.created_at)}
          </Txt>
        </Row>
        {instance.executed_at ? (
          <Txt variant="caption" tone="secondary">{`${tr('contracts.instances.status.executed')}: ${fmt.dateTime(instance.executed_at)}`}</Txt>
        ) : null}
        {instance.voided_at ? <Txt variant="caption" tone="danger">{`${tr('contracts.instances.status.voided')}: ${fmt.dateTime(instance.voided_at)}`}</Txt> : null}
        {instance.pdf_error ? (
          <Txt variant="caption" tone="danger">
            {instance.pdf_error}
          </Txt>
        ) : null}
      </Card>

      {instance.status === 'executed' || (canManage && open) || canFinalize ? (
        <View style={{ gap: t.spacing.sm }}>
          {instance.status === 'executed' ? (
            <Button label={tr('contracts.instances.download_pdf')} loading={downloading} icon={<Download size={18} color={t.colors.onPrimary} />} onPress={downloadPdf} />
          ) : null}
          {canFinalize ? (
            <Button label={tr('mobile.documents.finalize')} variant="secondary" loading={finalize.isPending} onPress={() => finalize.mutate(undefined)} />
          ) : null}
          {canManage && open ? (
            <Button
              label={tr('contracts.instances.void')}
              variant="outline"
              loading={voidInstance.isPending}
              icon={<Ban size={18} color={t.colors.danger} />}
              onPress={async () => {
                if (await confirm({ title: tr('contracts.instances.void'), message: tr('contracts.instances.void_confirm'), confirmLabel: tr('contracts.instances.void'), destructive: true }))
                  voidInstance.mutate(undefined);
              }}
            />
          ) : null}
        </View>
      ) : null}

      <Section title={`${tr('contracts.instances.signers')} (${signers.length})`}>
        <Group>
          {signers.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              —
            </Txt>
          ) : (
            signers.map((s, i) => (
              <View
                key={s.uuid}
                style={{
                  padding: t.spacing.lg,
                  gap: t.spacing.sm,
                  borderBottomWidth: i === signers.length - 1 ? 0 : 1,
                  borderBottomColor: t.colors.border,
                }}
              >
                <Row gap={t.spacing.sm}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong">
                      {s.label}
                      {s.suggested_name ? <Txt tone="secondary">{` · ${s.suggested_name}`}</Txt> : null}
                    </Txt>
                    <Txt variant="caption" tone="secondary">
                      {s.role}
                      {s.required ? ` · ${tr('contracts.fields.required')}` : ''}
                      {s.otp_required
                        ? ` · ${s.otp_verified_at ? tr('contracts.otp.verified_short', { phone: s.otp_phone_masked ?? '' }) : tr('contracts.otp.required_short')}`
                        : ''}
                    </Txt>
                  </View>
                  <Badge size="sm" tone={s.status === 'signed' ? 'success' : 'neutral'} label={signerStatusLabel(tr, s.status)} />
                </Row>
                {canMutate && s.status === 'pending' ? <Button size="sm" label={tr('contracts.instances.sign')} onPress={() => setSigning(s.uuid)} /> : null}
              </View>
            ))
          )}
        </Group>
      </Section>

      <Section title={tr('contracts.instances.preview')}>
        <Card style={{ gap: t.spacing.md, paddingTop: 0, overflow: 'hidden' }}>
          <View style={{ height: 5, marginHorizontal: -t.spacing.lg, backgroundColor: t.colors.primary }} />
          <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Txt variant="label" tone="muted">
                {tr('contracts.instances.preview')}
              </Txt>
              <Txt variant="heading">{instance.title}</Txt>
            </View>
            <View style={{ alignItems: 'flex-end', padding: t.spacing.sm, borderRadius: t.radius.md, backgroundColor: t.colors.primarySoft }}>
              <Txt variant="label" tone="muted">
                {tr('contracts.fields.number')}
              </Txt>
              <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
                {instance.number_label || '—'}
              </Txt>
              <Txt variant="caption" tone="secondary">
                {fmt.date(instance.created_at)}
              </Txt>
            </View>
          </Row>
          <View style={{ width: 56, height: 2, borderRadius: 1, backgroundColor: t.colors.primary }} />
          <ContractHtml html={instance.content_html} />
        </Card>
      </Section>

      <Section title={`${tr('contracts.instances.gallery')} (${media.length})`}>
        <Txt variant="caption" tone="secondary">
          {tr('contracts.instances.gallery_help')}
        </Txt>
        {media.length === 0 ? (
          <Txt variant="caption" tone="muted">
            {tr('contracts.instances.gallery_empty')}
          </Txt>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {media.map((m) => {
              const src = m.url ? apiUrl(m.url) : null;
              return (
                <Card key={m.uuid} padded={false} style={{ width: '48%', overflow: 'hidden' }}>
                  {src && m.content_type.startsWith('image/') ? (
                    <Image source={{ uri: src }} style={{ width: '100%', height: 110 }} resizeMode="cover" accessibilityLabel={m.file_name} />
                  ) : (
                    <View style={{ height: 110, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surfaceAlt, padding: t.spacing.sm }}>
                      <FileText size={24} color={t.colors.textMuted} />
                      <Txt variant="caption" tone="secondary" numberOfLines={2} style={{ textAlign: 'center' }}>
                        {m.file_name}
                      </Txt>
                    </View>
                  )}
                  <Row gap={4} style={{ padding: t.spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="caption" style={{ fontWeight: '600' }} numberOfLines={1}>
                        {m.file_name}
                      </Txt>
                      {m.caption ? (
                        <Txt variant="caption" tone="secondary" numberOfLines={1}>
                          {m.caption}
                        </Txt>
                      ) : null}
                    </View>
                    {canMutate ? (
                      <IconButton
                        variant="ghost"
                        label={tr('common.delete')}
                        disabled={deleteMedia.isPending}
                        icon={<Trash2 size={16} color={t.colors.danger} />}
                        onPress={() => deleteMedia.mutate(m.uuid)}
                      />
                    ) : null}
                  </Row>
                </Card>
              );
            })}
          </View>
        )}
        <Txt variant="caption" tone="muted">
          {canMutate ? tr('mobile.documents.media_upload_web') : tr('contracts.instances.gallery_locked')}
        </Txt>
      </Section>

      <SignSheet instance={instance} signerUuid={signing} onClose={() => setSigning(null)} />
      {instance.template_uuid && canManage ? (
        <Button variant="ghost" size="sm" label={tr('contracts.templates.edit_title')} onPress={() => router.push(`/contracts/templates/${instance.template_uuid}`)} />
      ) : null}
    </Screen>
  );
}
