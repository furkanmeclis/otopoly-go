import { Bell, Pencil, Play } from 'lucide-react-native';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Badge, Button, Card, Row, Skeleton, TextField, Txt } from '@/components/ui';
import { TemplateEditorSheet } from '@/features/messaging/components/template-editor';
import { renderTemplate, typeKey } from '@/features/messaging/lib/render';
import { useNotificationRules, useSimulateMessaging, useSmsChannel, useTemplateCatalog, useToggleRule } from '@/features/messaging/queries';
import { SAMPLE_VARS } from '@/features/messaging/types';
import { hasTranslation } from '@/lib/i18n/translate';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Automatic customer notifications per event (web `NotificationRulesCard`). */
export function NotificationRulesCard({ canWrite }: { canWrite: boolean }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const rules = useNotificationRules();
  const catalog = useTemplateCatalog();
  const toggle = useToggleRule();
  const simulate = useSimulateMessaging();
  const sms = useSmsChannel();
  const smsAvailable = Boolean(sms.data?.active_provider);
  const [editorType, setEditorType] = useState<string | null>(null);
  const [simPhone, setSimPhone] = useState('');
  const types = catalog.data ?? [];
  const lists = rules.data ?? [];

  const previewFor = (eventType: string) => {
    const type = types.find((x) => x.type === eventType);
    const entry = type?.templates.find((e) => e.channel === 'whatsapp' && e.locale === 'tr');
    if (!type || !entry) return '';
    return renderTemplate(entry.body, Object.fromEntries(type.placeholders.map((p) => [p.key, p.sample_tr])));
  };
  const label = (eventType: string, fallback: string) => {
    const key = `messaging.types.${typeKey(eventType)}`;
    return hasTranslation(locale, key) ? tr(key) : fallback;
  };

  return (
    <Card style={{ gap: t.spacing.md }}>
      <Row gap={t.spacing.sm}>
        <Bell size={20} color={t.colors.text} />
        <Txt variant="heading" style={{ flex: 1 }}>
          {tr('messaging.rules.title')}
        </Txt>
      </Row>
      <Txt variant="caption" tone="secondary">
        {tr('messaging.rules.description')}
      </Txt>

      {canWrite ? (
        <View style={{ gap: t.spacing.sm, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: t.spacing.md, backgroundColor: t.colors.surfaceAlt }}>
          <Txt variant="bodyStrong">{tr('messaging.rules.simulate_title')}</Txt>
          <Txt variant="caption" tone="secondary">
            {tr('messaging.rules.simulate_body')}
          </Txt>
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField value={simPhone} onChangeText={setSimPhone} placeholder="05xxxxxxxxx" keyboardType="phone-pad" accessibilityLabel={tr('messaging.editor.test_phone')} />
            </View>
            <Button
              size="sm"
              variant="secondary"
              label={tr('messaging.rules.simulate')}
              icon={<Play size={14} color={t.colors.text} />}
              loading={simulate.isPending}
              disabled={!simPhone.trim()}
              onPress={() => simulate.mutate({ mode: 'job_lifecycle', channel: 'whatsapp', phone: simPhone.trim(), vars: SAMPLE_VARS })}
              style={{ marginBottom: 4 }}
            />
          </Row>
        </View>
      ) : null}

      {rules.isLoading ? (
        <View style={{ gap: t.spacing.sm }}>
          <Skeleton height={52} />
          <Skeleton height={52} />
          <Skeleton height={52} />
        </View>
      ) : null}
      {rules.isError ? (
        <Txt variant="caption" tone="danger">
          {tr('messaging.rules.load_failed')}
        </Txt>
      ) : null}
      {!rules.isLoading && !rules.isError && lists.length === 0 ? (
        <Txt variant="caption" tone="secondary">
          {tr('messaging.rules.empty')}
        </Txt>
      ) : null}

      {sms.isSuccess && !smsAvailable && lists.length > 0 ? (
        <Txt variant="caption" tone="muted">
          {tr('mobile.messaging.rules.sms_needs_provider')}
        </Txt>
      ) : null}
      {lists.map((rl, i) => {
        const preview = previewFor(rl.event_type);
        return (
          <View key={rl.event_type} style={{ gap: t.spacing.sm, paddingTop: i === 0 ? 0 : t.spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.border }}>
            <Txt variant="bodyStrong">{label(rl.event_type, rl.event_label)}</Txt>
            <Row gap={t.spacing.md} wrap style={{ alignItems: 'center' }}>
              {rl.rules.map((rule) =>
                rule.channel === 'sms' ? (
                  // SMS goes through the organization's active SMS provider (Kanallar); without one it stays locked.
                  <Row key="sms" gap={6} style={{ opacity: !smsAvailable && !rule.enabled ? 0.5 : 1 }}>
                    <Switch
                      value={rule.enabled}
                      disabled={!canWrite || toggle.isPending || (!smsAvailable && !rule.enabled)}
                      onValueChange={() => toggle.mutate({ eventType: rl.event_type, channel: rule.channel, enabled: !rule.enabled })}
                      trackColor={{ true: t.colors.primary, false: t.colors.borderStrong }}
                      accessibilityLabel={`${label(rl.event_type, rl.event_label)} · SMS`}
                      accessibilityHint={!smsAvailable ? tr('mobile.messaging.rules.sms_needs_provider') : undefined}
                    />
                    <Badge size="sm" tone={rule.enabled ? 'success' : 'neutral'} label="SMS" />
                  </Row>
                ) : rule.channel === 'whatsapp' ? (
                  <Row key="wa" gap={6}>
                    <Switch
                      value={rule.enabled}
                      disabled={!canWrite || toggle.isPending}
                      onValueChange={() => toggle.mutate({ eventType: rl.event_type, channel: rule.channel, enabled: !rule.enabled })}
                      trackColor={{ true: t.colors.primary, false: t.colors.borderStrong }}
                      accessibilityLabel={`${label(rl.event_type, rl.event_label)} · WhatsApp`}
                    />
                    <Badge size="sm" tone={rule.enabled ? 'success' : 'neutral'} label="WhatsApp" />
                  </Row>
                ) : null,
              )}
              <Button size="sm" variant="ghost" label={tr('messaging.rules.edit_message')} icon={<Pencil size={14} color={t.colors.text} />} onPress={() => setEditorType(rl.event_type)} />
            </Row>
            {preview ? (
              <Txt variant="caption" tone="muted" numberOfLines={2}>
                {preview}
              </Txt>
            ) : null}
          </View>
        );
      })}

      <TemplateEditorSheet type={types.find((x) => x.type === editorType) ?? null} initialChannel="whatsapp" canWrite={canWrite} onClose={() => setEditorType(null)} />
    </Card>
  );
}
