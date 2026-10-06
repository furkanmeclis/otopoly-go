/**
 * Template detail (web `ContractTemplateDetailPage`). Owners edit title, description, switches and signer
 * slots; the contract body uses a Lexical rich-text editor on the web, so on mobile it is a read-only
 * preview and body edits stay on the web (PATCH omits content fields, which the backend keeps as-is).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorState, Header, IconButton, ListSkeleton, Screen, Section, SwitchRow, TextField, Txt, useConfirm } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { DEFAULT_SIGNER_SLOTS, type SignerSlot } from '@/features/contract-presets/services/contract-presets.service';
import { ContractHtml } from '@/features/contracts/components/contract-html';
import { SignerSlotsEditor } from '@/features/contracts/components/signer-slots-editor';
import { useContractsAccess } from '@/features/contracts/lib/access';
import { contractKeys, useContractTemplate } from '@/features/contracts/queries';
import { contractsService, type ContractTemplate } from '@/features/contracts/services/contracts.service';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function ContractTemplateScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.contractsRead} title={tr('contracts.templates.edit_title')}>
      <TemplateDetail />
    </RequirePermission>
  );
}

function TemplateDetail() {
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useContractTemplate(id);

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('contracts.templates.edit_title')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen header={<Header title={tr('contracts.templates.edit_title')} />}>
        <ErrorState description={tr('contracts.templates.error_description')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  return <TemplateForm key={`${query.data.uuid}-${query.data.updated_at}`} template={query.data} refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />;
}

type FormState = {
  title: string;
  description: string;
  category: string;
  signer_slots: SignerSlot[];
  signature_required: boolean;
  otp_required: boolean;
  is_active: boolean;
};

function TemplateForm({ template, refreshing, onRefresh }: { template: ContractTemplate; refreshing: boolean; onRefresh: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const confirm = useConfirm();
  const { canManage } = useContractsAccess();
  const [form, setForm] = useState<FormState>({
    title: template.title,
    description: template.description ?? '',
    category: template.category || 'general',
    signer_slots: template.signer_slots?.length ? template.signer_slots : DEFAULT_SIGNER_SLOTS,
    signature_required: template.signature_required,
    otp_required: template.otp_required ?? false,
    is_active: template.is_active,
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const save = useApiMutation({
    key: 'contracts.templates.update',
    fn: () =>
      contractsService.updateTemplate(template.uuid, {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category.trim() || 'general',
        signer_slots: form.signer_slots.filter((s) => s.role.trim()),
        signature_required: form.signature_required,
        otp_required: form.otp_required,
        is_active: form.is_active,
      }),
    invalidate: [contractKeys.all],
    success: tr('contracts.templates.toast.updated'),
  });
  const remove = useApiMutation({
    key: 'contracts.templates.delete',
    fn: () => contractsService.removeTemplate(template.uuid),
    invalidate: [contractKeys.all],
    success: tr('contracts.templates.toast.deleted'),
    toastValidation: true,
    onSuccess: () => router.back(),
  });
  const errors = fieldErrors(save.error);

  return (
    <Screen
      header={
        <Header
          title={form.title || tr('contracts.templates.edit_title')}
          subtitle={tr('contracts.templates.edit_title')}
          right={
            canManage ? (
              <IconButton
                label={tr('contracts.templates.delete')}
                disabled={remove.isPending}
                icon={<Trash2 size={18} color={t.colors.danger} />}
                onPress={async () => {
                  if (await confirm({ title: tr('contracts.templates.delete'), message: tr('contracts.templates.delete_confirm'), confirmLabel: tr('common.delete'), destructive: true }))
                    remove.mutate(undefined);
                }}
              />
            ) : undefined
          }
        />
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        canManage ? (
          <Button label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} disabled={!form.title.trim()} onPress={() => save.mutate(undefined)} />
        ) : undefined
      }
    >
      <Txt variant="caption" tone="secondary">
        {tr('contracts.templates.form_description')}
      </Txt>
      <Section title={tr('contracts.sections.basics')}>
        <Card style={{ gap: t.spacing.md }}>
          <TextField
            label={tr('contracts.fields.title')}
            required
            value={form.title}
            editable={canManage}
            placeholder={tr('contracts.fields.title_placeholder')}
            error={errors.title}
            onChangeText={(v) => set('title', v)}
          />
          <TextField
            label={tr('contracts.fields.description')}
            value={form.description}
            editable={canManage}
            placeholder={tr('contracts.fields.description_placeholder')}
            error={errors.description}
            onChangeText={(v) => set('description', v)}
          />
          <SwitchRow label={tr('contracts.fields.signature_required')} value={form.signature_required} disabled={!canManage} onValueChange={(v) => set('signature_required', v)} />
          <SwitchRow
            label={tr('contracts.fields.otp_required')}
            description={tr('contracts.fields.otp_required_hint')}
            value={form.otp_required}
            disabled={!canManage}
            onValueChange={(v) => set('otp_required', v)}
          />
          <SwitchRow label={tr('contracts.fields.active')} value={form.is_active} disabled={!canManage} onValueChange={(v) => set('is_active', v)} />
        </Card>
      </Section>

      <Section title={tr('contracts.sections.body')}>
        <Card style={{ gap: t.spacing.md }}>
          <Txt variant="caption" tone="muted">
            {tr('mobile.documents.template_body_web_only')}
          </Txt>
          <View style={{ height: 1, backgroundColor: t.colors.border }} />
          <ContractHtml html={template.content_html} />
          {template.variables?.length ? (
            <Txt variant="caption" tone="secondary">
              {`${tr('contracts.fields.variables')}: ${template.variables.map((v) => tr(`contracts.variables.${v}`)).join(', ')}`}
            </Txt>
          ) : null}
        </Card>
      </Section>

      <Section title={tr('contracts.sections.signers')}>
        <SignerSlotsEditor value={form.signer_slots} disabled={!canManage} onChange={(v) => set('signer_slots', v)} />
      </Section>
    </Screen>
  );
}
