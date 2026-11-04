/** Small create flows: web `CreateInstanceDialog` and `ClonePresetDialog`. */
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, Group, SelectField, Sheet, TextField, Txt } from '@/components/ui';
import { useJobs } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

import { contractKeys, useActiveContractTemplates, useTenantContractPresets } from '../queries';
import { contractsService } from '../services/contracts.service';

/** New contract for a service job. `defaultJobUuid` (from `?job_uuid=`) locks the job, like the web. */
export function CreateInstanceSheet({ visible, onClose, defaultJobUuid }: { visible: boolean; onClose: () => void; defaultJobUuid?: string }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('contracts.instances.create_title')}>
      {visible ? <CreateInstanceBody onClose={onClose} defaultJobUuid={defaultJobUuid} /> : null}
    </Sheet>
  );
}

function CreateInstanceBody({ onClose, defaultJobUuid }: { onClose: () => void; defaultJobUuid?: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [templateUuid, setTemplateUuid] = useState('');
  const [jobUuid, setJobUuid] = useState(defaultJobUuid ?? '');
  const templates = useActiveContractTemplates();
  const jobs = useJobs({ limit: 50, offset: 0, status: 'in_progress', sort: '-started_at' });

  const create = useApiMutation({
    key: 'contracts.instances.create',
    fn: () => contractsService.createInstance({ template_uuid: templateUuid, subject_type: 'service_job', subject_uuid: jobUuid }),
    invalidate: [contractKeys.all],
    success: tr('contracts.instances.toast.created'),
    toastValidation: true,
    onSuccess: (created) => {
      onClose();
      router.push(`/contracts/instances/${created.uuid}`);
    },
  });

  const jobOptions = (jobs.data?.items ?? []).map((j) => ({ value: j.uuid, label: `${j.plate} · ${j.customer_name}`, description: j.vehicle_label }));
  if (defaultJobUuid && !jobOptions.some((o) => o.value === defaultJobUuid)) jobOptions.unshift({ value: defaultJobUuid, label: defaultJobUuid, description: '' });

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt variant="caption" tone="secondary">
        {tr('contracts.instances.create_description')}
      </Txt>
      <SelectField
        label={tr('contracts.instances.create_template')}
        required
        value={templateUuid || null}
        loading={templates.isLoading}
        searchable
        placeholder={tr('contracts.instances.create_template')}
        options={(templates.data?.items ?? []).map((tpl) => ({ value: tpl.uuid, label: tpl.title, description: tpl.category || undefined }))}
        onChange={(v) => setTemplateUuid(v ?? '')}
      />
      <SelectField
        label={tr('contracts.instances.create_job')}
        required
        value={jobUuid || null}
        loading={jobs.isLoading}
        searchable
        disabled={Boolean(defaultJobUuid)}
        placeholder={tr('contracts.instances.create_job_placeholder')}
        options={jobOptions}
        onChange={(v) => setJobUuid(v ?? '')}
      />
      <Txt variant="caption" tone="muted">
        {defaultJobUuid ? tr('contracts.instances.auto_subject_binding') : tr('contracts.instances.create_job_required')}
      </Txt>
      <Button
        label={create.isPending ? tr('common.saving') : tr('contracts.instances.create')}
        loading={create.isPending}
        disabled={!templateUuid || !jobUuid}
        onPress={() => create.mutate(undefined)}
      />
      <Button variant="outline" label={tr('common.cancel')} onPress={onClose} />
    </View>
  );
}

/** Owner: copy an active platform preset into this organization's templates. */
export function ClonePresetSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={visible} onClose={onClose} title={tr('contracts.templates.clone_title')}>
      {visible ? <ClonePresetBody onClose={onClose} /> : null}
    </Sheet>
  );
}

function ClonePresetBody({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const presets = useTenantContractPresets();
  const [presetUuid, setPresetUuid] = useState('');
  const [title, setTitle] = useState('');
  const items = presets.data?.items ?? [];

  const clone = useApiMutation({
    key: 'contracts.templates.clone',
    fn: () => contractsService.cloneTemplate({ preset_uuid: presetUuid.trim(), title: title.trim() || undefined }),
    invalidate: [contractKeys.all],
    success: tr('contracts.templates.toast.cloned'),
    toastValidation: true,
    onSuccess: (created) => {
      onClose();
      router.push(`/contracts/templates/${created.uuid}`);
    },
  });

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Txt variant="caption" tone="secondary">
        {tr('contracts.templates.clone_description')}
      </Txt>
      <Group>
        {presets.isLoading ? (
          <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} accessibilityLabel={tr('common.loading')} />
        ) : presets.isError ? (
          <Txt variant="caption" tone="secondary" style={{ padding: t.spacing.lg }}>
            {tr('contracts.templates.clone_forbidden')}
          </Txt>
        ) : items.length === 0 ? (
          <Txt variant="caption" tone="secondary" style={{ padding: t.spacing.lg }}>
            {tr('contracts.templates.clone_empty')}
          </Txt>
        ) : (
          items.map((preset, i) => {
            const active = preset.uuid === presetUuid;
            return (
              <Pressable
                key={preset.uuid}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setPresetUuid(preset.uuid);
                  if (!title) setTitle(preset.title);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                  paddingHorizontal: t.spacing.lg,
                  paddingVertical: t.spacing.md,
                  borderBottomWidth: i === items.length - 1 ? 0 : 1,
                  borderBottomColor: t.colors.border,
                  backgroundColor: active ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : 'transparent',
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong">{preset.title}</Txt>
                  {preset.description ? (
                    <Txt variant="caption" tone="secondary" numberOfLines={2}>
                      {preset.description}
                    </Txt>
                  ) : null}
                </View>
                {active ? <Check size={18} color={t.colors.primary} /> : null}
              </Pressable>
            );
          })
        )}
      </Group>
      {presets.isError ? (
        <TextField
          label={tr('contracts.templates.clone_uuid')}
          placeholder={tr('contracts.templates.clone_uuid_placeholder')}
          value={presetUuid}
          onChangeText={setPresetUuid}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
      <TextField label={tr('contracts.fields.title')} value={title} onChangeText={setTitle} />
      <Button
        label={clone.isPending ? tr('common.saving') : tr('contracts.templates.clone_submit')}
        loading={clone.isPending}
        disabled={!presetUuid.trim()}
        onPress={() => clone.mutate(undefined)}
      />
      <Button variant="outline" label={tr('common.cancel')} onPress={onClose} />
    </View>
  );
}
