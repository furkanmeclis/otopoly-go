import { AlertTriangle, RotateCcw, Send } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, View, type TextInputInstance } from 'react-native';

import { Button, Card, IconButton, Row, Segmented, Sheet, SwitchRow, TextField, Txt, useConfirm } from '@/components/ui';
import { renderTemplate, typeKey, unknownPlaceholders } from '@/features/messaging/lib/render';
import { useSimulateMessaging, useTemplateMutations } from '@/features/messaging/queries';
import type { MessageTemplateEntry, MessageTemplateType, TemplateChannel, TemplateLocale } from '@/features/messaging/services/templates.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Draft = { subject: string; body: string; isActive: boolean };
const LOCALES: TemplateLocale[] = ['tr', 'en'];

const entryFor = (type: MessageTemplateType, channel: TemplateChannel, locale: TemplateLocale): MessageTemplateEntry | undefined =>
  type.templates.find((e) => e.channel === channel && e.locale === locale);

/** Template editor sheet (web `MessageTemplateEditor` dialog). */
export function TemplateEditorSheet({ type, initialChannel, canWrite, onClose }: { type: MessageTemplateType | null; initialChannel?: TemplateChannel; canWrite: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  return (
    <Sheet visible={Boolean(type)} onClose={onClose} title={type ? tr('messaging.editor.title', { type: tr(`messaging.types.${typeKey(type.type)}`) }) : ''}>
      {type ? <EditorBody key={type.type} type={type} initialChannel={initialChannel} canWrite={canWrite} onClose={onClose} /> : null}
    </Sheet>
  );
}

function EditorBody({ type, initialChannel, canWrite, onClose }: { type: MessageTemplateType; initialChannel?: TemplateChannel; canWrite: boolean; onClose: () => void }) {
  const t = useTheme();
  const { t: tr, locale: uiLocale } = useLocale();
  const confirm = useConfirm();
  const { save, reset } = useTemplateMutations();
  const simulate = useSimulateMessaging();
  const [channel, setChannel] = useState<TemplateChannel>(initialChannel && type.channels.includes(initialChannel) ? initialChannel : type.channels[0]);
  const [locale, setLocale] = useState<TemplateLocale>(uiLocale === 'en' ? 'en' : 'tr');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [testPhone, setTestPhone] = useState('');
  const selection = useRef<{ start: number; end: number } | null>(null);
  const bodyRef = useRef<TextInputInstance>(null);

  const entry = entryFor(type, channel, locale);
  const draftKey = `${channel}:${locale}`;
  const draft: Draft = drafts[draftKey] ?? { subject: entry?.subject ?? '', body: entry?.body ?? '', isActive: entry?.is_active ?? true };
  const setDraft = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [draftKey]: { ...draft, ...patch } }));
  const clearDraft = () =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[draftKey];
      return next;
    });

  const allowed = useMemo(() => type.placeholders.map((p) => p.key), [type.placeholders]);
  const samples = useMemo(() => Object.fromEntries(type.placeholders.map((p) => [p.key, locale === 'en' ? p.sample_en : p.sample_tr])), [type.placeholders, locale]);
  const unknown = unknownPlaceholders(allowed, draft.subject, draft.body);
  const previewTitle = renderTemplate(draft.subject, samples);
  const previewBody = renderTemplate(draft.body, samples);
  const phoneChannel = channel === 'whatsapp' || channel === 'sms';
  const dirty = !entry || draft.subject !== entry.subject || draft.body !== entry.body || draft.isActive !== entry.is_active;
  const key = { eventType: type.type, channel, locale };
  const pending = save.isPending || reset.isPending;

  const insert = (placeholder: string) => {
    const snippet = `{{${placeholder}}}`;
    const start = selection.current?.start ?? draft.body.length;
    const end = selection.current?.end ?? draft.body.length;
    setDraft({ body: draft.body.slice(0, start) + snippet + draft.body.slice(end) });
    selection.current = { start: start + snippet.length, end: start + snippet.length };
    bodyRef.current?.focus();
  };

  const onReset = async () => {
    if (!(await confirm({ title: tr('messaging.editor.reset'), message: tr('messaging.editor.reset_confirm'), destructive: true, confirmLabel: tr('messaging.editor.reset') }))) return;
    reset.mutate(key, { onSuccess: clearDraft });
  };

  return (
    <>
      <Txt variant="caption" tone="secondary">
        {tr('messaging.editor.description')}
      </Txt>
      <View style={{ gap: t.spacing.sm }}>
        <Segmented<TemplateChannel>
          value={channel}
          onChange={setChannel}
          options={type.channels.map((ch) => {
            const e = entryFor(type, ch, locale);
            const mark = e && !e.is_active ? ` · ${tr('messaging.badge.passive')}` : e?.is_custom ? ' •' : '';
            return { value: ch, label: `${tr(`messaging.channel.${ch}`)}${mark}` };
          })}
        />
        <Segmented<TemplateLocale> value={locale} onChange={setLocale} options={LOCALES.map((l) => ({ value: l, label: tr(`messaging.locale.${l}`) }))} />
      </View>

      <Card>
        <SwitchRow label={tr('messaging.editor.active')} description={tr('messaging.editor.active_hint')} value={draft.isActive} onValueChange={(v) => setDraft({ isActive: v })} disabled={!canWrite} />
      </Card>

      <TextField
        label={tr('messaging.editor.subject')}
        value={draft.subject}
        maxLength={200}
        editable={canWrite}
        onChangeText={(v) => setDraft({ subject: v })}
        hint={phoneChannel ? tr('messaging.editor.subject_hint') : undefined}
      />
      <TextField
        ref={bodyRef}
        label={tr('messaging.editor.body')}
        value={draft.body}
        maxLength={4000}
        editable={canWrite}
        multiline
        onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
        onChangeText={(v) => setDraft({ body: v })}
        style={{ minHeight: 180, fontFamily: 'Menlo', fontSize: 13 }}
        error={!draft.body.trim() && canWrite ? tr('messaging.editor.body_required') : null}
      />

      <View style={{ gap: t.spacing.xs }}>
        <Txt variant="bodyStrong">{tr('messaging.editor.placeholders')}</Txt>
        <Txt variant="caption" tone="secondary">
          {tr('messaging.editor.placeholders_hint')}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {type.placeholders.map((p) => (
            <Pressable
              key={p.key}
              disabled={!canWrite}
              onPress={() => insert(p.key)}
              accessibilityRole="button"
              accessibilityLabel={`{{${p.key}}} — ${locale === 'en' ? p.sample_en : p.sample_tr}`}
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: t.radius.sm,
                paddingHorizontal: 8,
                paddingVertical: 5,
                backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                opacity: canWrite ? 1 : 0.5,
              })}
            >
              <Txt variant="caption" style={{ fontFamily: 'Menlo', fontSize: 11 }}>{`{{${p.key}}}`}</Txt>
            </Pressable>
          ))}
        </View>
      </View>

      {unknown.length > 0 ? (
        <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start', backgroundColor: t.colors.dangerBg, borderRadius: t.radius.sm, padding: t.spacing.md }}>
          <AlertTriangle size={16} color={t.colors.danger} />
          <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
            {tr('messaging.editor.unknown', { list: unknown.map((k) => `{{${k}}}`).join(', ') })}
          </Txt>
        </Row>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <Txt variant="bodyStrong">{tr('messaging.editor.preview')}</Txt>
        <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.lg, padding: t.spacing.md }}>
          <View style={{ backgroundColor: phoneChannel ? t.colors.successBg : t.colors.surface, borderRadius: t.radius.lg, padding: t.spacing.md, gap: 6, opacity: draft.isActive ? 1 : 0.5 }}>
            <Txt variant="label" tone="muted">
              {tr(`messaging.channel.${channel}`)} · {tr(`messaging.locale.${locale}`)}
            </Txt>
            {!phoneChannel && previewTitle ? <Txt variant="bodyStrong">{previewTitle}</Txt> : null}
            <View style={{ backgroundColor: t.colors.surface, borderRadius: t.radius.md, paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm }}>
              <Txt selectable>{previewBody || tr('messaging.editor.preview_empty')}</Txt>
            </View>
          </View>
        </View>
      </View>

      {canWrite && channel === 'whatsapp' && locale === 'tr' ? (
        <View style={{ gap: t.spacing.xs }}>
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField label={tr('messaging.editor.test_phone')} value={testPhone} onChangeText={setTestPhone} placeholder="05xxxxxxxxx" keyboardType="phone-pad" />
            </View>
            <IconButton
              label={tr('messaging.editor.test_send')}
              variant="primary"
              disabled={simulate.isPending || !testPhone.trim() || dirty}
              icon={<Send size={18} color={t.colors.onPrimary} />}
              onPress={() => simulate.mutate({ mode: 'event', event_type: type.type, channel: 'whatsapp', phone: testPhone.trim(), vars: samples })}
              style={{ marginBottom: 2 }}
            />
          </Row>
          <Txt variant="caption" tone="secondary">
            {tr('messaging.editor.test_hint')}
          </Txt>
        </View>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        {canWrite ? (
          <Button
            label={tr('messaging.editor.save')}
            loading={save.isPending}
            disabled={pending || !dirty || !draft.body.trim() || unknown.length > 0}
            onPress={() => save.mutate({ key, body: { subject: draft.subject, body: draft.body, is_active: draft.isActive } }, { onSuccess: clearDraft })}
          />
        ) : null}
        {canWrite && entry?.is_custom ? (
          <Button variant="ghost" label={tr('messaging.editor.reset')} icon={<RotateCcw size={16} color={t.colors.text} />} disabled={pending} onPress={() => void onReset()} />
        ) : null}
        <Button variant="outline" label={tr('messaging.editor.cancel')} onPress={onClose} />
      </View>
    </>
  );
}
