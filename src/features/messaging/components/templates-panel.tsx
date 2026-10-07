import { FileText, Lock, Pencil } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, Row, Section, Txt } from '@/components/ui';
import { TemplateEditorSheet } from '@/features/messaging/components/template-editor';
import { renderTemplate, typeKey } from '@/features/messaging/lib/render';
import { useTemplateCatalog } from '@/features/messaging/queries';
import type { MessageTemplateType, TemplateChannel } from '@/features/messaging/services/templates.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Template catalog grouped by module (web `MessageTemplatesPanel`). */
export function TemplatesPanel({ canWrite: canWriteRole, ownNumberEntitled = true }: { canWrite: boolean; ownNumberEntitled?: boolean }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const canWrite = canWriteRole && ownNumberEntitled;
  const catalog = useTemplateCatalog();
  const [editing, setEditing] = useState<{ type: string; channel?: TemplateChannel } | null>(null);
  const loc = locale === 'en' ? 'en' : 'tr';

  const groups = useMemo(() => {
    const map = new Map<string, MessageTemplateType[]>();
    for (const type of catalog.data ?? []) map.set(type.group, [...(map.get(type.group) ?? []), type]);
    return [...map.entries()];
  }, [catalog.data]);

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Card style={{ gap: t.spacing.sm }}>
        <Row gap={t.spacing.sm}>
          <FileText size={20} color={t.colors.text} />
          <Txt variant="heading" style={{ flex: 1 }}>
            {tr('messaging.templates.title')}
          </Txt>
        </Row>
        <Txt variant="caption" tone="secondary">
          {tr('messaging.templates.description')}
          {!canWriteRole ? ` ${tr('messaging.templates.read_only')}` : ''}
        </Txt>
      </Card>

      {!ownNumberEntitled ? (
        <Card>
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
            <Lock size={16} color={t.colors.textMuted} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="bodyStrong">{tr('messaging.templates.platform_title')}</Txt>
              <Txt variant="caption" tone="secondary">
                {tr('messaging.templates.platform_body')}
              </Txt>
            </View>
          </Row>
        </Card>
      ) : null}

      {catalog.isLoading ? (
        <ListSkeleton rows={4} height={88} />
      ) : catalog.isError ? (
        <ErrorState description={tr('messaging.templates.error')} onRetry={() => void catalog.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState title={tr('messaging.templates.empty')} />
      ) : (
        groups.map(([group, types]) => (
          <Section key={group} title={tr(`messaging.group.${group}`)}>
            <Card padded={false}>
              {types.map((type, i) => {
                const first = type.templates.find((e) => e.locale === loc && e.channel === type.channels[0]);
                const samples = Object.fromEntries(type.placeholders.map((p) => [p.key, loc === 'en' ? p.sample_en : p.sample_tr]));
                return (
                  <View key={type.type} style={{ padding: t.spacing.md, gap: t.spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.border }}>
                    <Row gap={t.spacing.sm} wrap>
                      <Txt variant="bodyStrong" style={{ flexShrink: 1 }}>
                        {tr(`messaging.types.${typeKey(type.type)}`)}
                      </Txt>
                      <Badge size="sm" tone="neutral" label={tr(`messaging.audience.${type.audience}`)} />
                    </Row>
                    {first ? (
                      <Txt variant="caption" tone="secondary" numberOfLines={1}>
                        {renderTemplate(first.body, samples)}
                      </Txt>
                    ) : null}
                    <Row gap={6} wrap>
                      {type.channels.map((ch) => {
                        const e = type.templates.find((x) => x.channel === ch && x.locale === loc);
                        const suffix = e && !e.is_active ? ` · ${tr('messaging.badge.passive')}` : e?.is_custom ? ` · ${tr('messaging.badge.custom')}` : '';
                        return (
                          <Pressable key={ch} onPress={() => setEditing({ type: type.type, channel: ch })} accessibilityRole="button" hitSlop={4}>
                            <Badge size="sm" tone={e && !e.is_active ? 'neutral' : 'primary'} label={`${tr(`messaging.channel.${ch}`)}${suffix}`} />
                          </Pressable>
                        );
                      })}
                    </Row>
                    <Button size="sm" variant="ghost" label={tr('messaging.templates.edit')} icon={<Pencil size={14} color={t.colors.text} />} onPress={() => setEditing({ type: type.type })} style={{ alignSelf: 'flex-start' }} />
                  </View>
                );
              })}
            </Card>
          </Section>
        ))
      )}

      <TemplateEditorSheet type={catalog.data?.find((x) => x.type === editing?.type) ?? null} initialChannel={editing?.channel} canWrite={canWrite} onClose={() => setEditing(null)} />
    </View>
  );
}
