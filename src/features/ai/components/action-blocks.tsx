/**
 * Assistant write actions and plans, ported from the web chat (`confirm-card.tsx`, `plan-block.tsx`):
 *   confirm   — a change the assistant proposes; nothing happens until the user confirms (fields can
 *               be edited first), or cancels. Expired / resolved cards are read-only.
 *   todo_list — the assistant's checklist for a multi-step request, updated in place.
 */
import { router, type Href } from 'expo-router';
import { AlertTriangle, Ban, Check, Circle, CircleDashed, Clock, ExternalLink, ListChecks, Minus, Pencil, ShieldCheck, X } from 'lucide-react-native';
import { createContext, useContext, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, DateField, MoneyField, Row, SelectField, TextField, Txt, type Tone } from '@/components/ui';
import { actionErrorKey, confirmFieldKey, confirmStatusKey, confirmWarningKey, isConfirmValueKey, isSummaryKey, toolLabelKey } from '@/features/ai/lib/labels';
import type { AIActionLink, AIActionStatus, AIConfirmCard, AIEditField, AIPlan, AIUIBlock } from '@/features/ai/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

// ─── Chat actions (provided by the chat screen) ─────────────────────────────

export type ChatActions = {
  confirm: (card: AIUIBlock, edits?: Record<string, string>) => Promise<void>;
  cancel: (card: AIUIBlock) => Promise<void>;
  /** A turn is running: cards wait (web disables them while streaming). */
  busy: boolean;
};

const ChatActionsContext = createContext<ChatActions | null>(null);
export const ChatActionsProvider = ChatActionsContext.Provider;

/** App route for a record an action created or changed (web `linkHref`). */
export function actionLinkHref(link: AIActionLink): Href {
  switch (link.kind) {
    case 'customer':
      return `/customers/${link.uuid}`;
    case 'cari':
      return `/cari/${link.uuid}`;
    case 'job':
      return `/jobs/${link.uuid}`;
    case 'sale':
      return `/sales/${link.uuid}`;
    case 'finance_account':
      return `/finance/accounts/${link.uuid}`;
    default:
      return '/todos';
  }
}

const STATUS_TONE: Record<AIActionStatus, Tone> = {
  pending: 'info',
  executing: 'info',
  confirmed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

function StatusBadge({ status }: { status: AIActionStatus }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const color = tone === 'success' ? t.colors.success : tone === 'danger' ? t.colors.danger : tone === 'info' ? t.colors.info : t.colors.neutral;
  const Icon = status === 'confirmed' ? Check : status === 'failed' ? AlertTriangle : status === 'pending' ? Clock : Ban;
  return (
    <Badge
      size="sm"
      tone={tone}
      label={tr(confirmStatusKey(status))}
      icon={status === 'executing' ? <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: 0.6 }] }} /> : <Icon size={11} color={color} />}
    />
  );
}

function EditInput({ field, value, onChange, disabled }: { field: AIEditField; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t: tr } = useLocale();
  const label = `${tr(confirmFieldKey(field.key))}${field.required ? ' *' : ''}`;
  switch (field.type) {
    case 'select':
      return (
        <SelectField
          label={label}
          value={value}
          options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label_key && isConfirmValueKey(o.label_key) ? tr(o.label_key) : (o.label ?? o.value) }))}
          onChange={(v) => onChange(v ?? '')}
        />
      );
    case 'date':
    case 'time':
      return <DateField label={label} mode={field.type} value={value || null} onChange={(v) => onChange(v ?? '')} allowClear={!field.required} />;
    case 'money':
      return <MoneyField label={label} value={value} onChangeText={onChange} editable={!disabled} />;
    default:
      return <TextField label={label} value={value} onChangeText={onChange} editable={!disabled} multiline={field.type === 'textarea'} />;
  }
}

/** Confirmation card for a write action the assistant proposed (web `ConfirmCard`). */
export function ConfirmCard({ block }: { block: AIUIBlock }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const toast = useToast();
  const actions = useContext(ChatActionsContext);
  const card = block.data as AIConfirmCard | undefined;
  const status = (block.status ?? 'pending') as AIActionStatus;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  if (!card?.preview) return null;
  const { preview, result } = card;
  const editable = preview.edit ?? [];
  const pending = status === 'pending';
  const busy = submitting || Boolean(actions?.busy);
  const valueOf = (f: AIEditField) => values[f.key] ?? f.value ?? '';
  const changedEdits = () => Object.fromEntries(editable.filter((f) => values[f.key] !== undefined && values[f.key] !== f.value).map((f) => [f.key, values[f.key] ?? '']));

  const run = async (fn: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await fn();
      setEditing(false);
    } catch (error) {
      toast.error(tr(actionErrorKey(isApiError(error) ? error.code : undefined)), isApiError(error) && error.code === 'VALIDATION_ERROR' ? error.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const borderColor = status === 'confirmed' ? t.colors.success : status === 'failed' ? t.colors.danger : pending || status === 'executing' ? t.colors.primary : t.colors.border;
  const resolvedText = result?.ok
    ? isSummaryKey(result.summary_key)
      ? tr(result.summary_key, (result.summary_params ?? {}) as Record<string, string | number>)
      : tr('ai.confirm.done')
    : result?.message || tr('ai.confirm.failed');

  return (
    <View
      accessibilityLabel={`${tr(toolLabelKey(preview.action))}: ${preview.title}`}
      style={{ borderWidth: 2, borderColor, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, overflow: 'hidden', opacity: status === 'cancelled' || status === 'expired' ? 0.8 : 1 }}
    >
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start', justifyContent: 'space-between', padding: t.spacing.md, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Row gap={4}>
            <ShieldCheck size={13} color={t.colors.textMuted} />
            <Txt variant="caption" tone="muted" style={{ fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {tr(toolLabelKey(preview.action))}
            </Txt>
          </Row>
          <Txt variant="bodyStrong" numberOfLines={2}>
            {preview.title}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {preview.amount ? (
            <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
              {preview.amount}
            </Txt>
          ) : null}
          <StatusBadge status={status} />
        </View>
      </Row>

      {editing ? (
        <View style={{ padding: t.spacing.md, gap: t.spacing.sm }}>
          {editable.map((f) => (
            <EditInput key={f.key} field={f} value={valueOf(f)} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} disabled={busy} />
          ))}
        </View>
      ) : (
        <View style={{ paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm, gap: 6 }}>
          {preview.fields.map((f) => (
            <Row key={f.key} gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
              <Txt variant="caption" tone="muted" style={{ width: 110 }}>
                {tr(confirmFieldKey(f.key))}
              </Txt>
              <Txt variant="caption" style={{ flex: 1 }} selectable>
                {f.value_key && isConfirmValueKey(f.value_key) ? tr(f.value_key) : f.value && /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? fmt.date(`${f.value}T12:00:00`) : f.value}
              </Txt>
            </Row>
          ))}
        </View>
      )}

      {preview.warnings?.length && pending ? (
        <View style={{ paddingHorizontal: t.spacing.md, paddingBottom: t.spacing.sm, gap: 4 }}>
          {preview.warnings.map((w) => (
            <Row key={w} gap={6} style={{ alignItems: 'flex-start', backgroundColor: t.colors.warningBg, borderRadius: t.radius.sm, padding: 6 }}>
              <AlertTriangle size={12} color={t.colors.warning} style={{ marginTop: 2 }} />
              <Txt variant="caption" style={{ flex: 1, color: t.colors.warning }}>
                {tr(confirmWarningKey(w))}
              </Txt>
            </Row>
          ))}
        </View>
      ) : null}

      {result && !pending ? (
        <Row
          gap={t.spacing.sm}
          wrap
          style={{
            justifyContent: 'space-between',
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: t.colors.border,
            backgroundColor: result.ok ? t.colors.successBg : t.colors.dangerBg,
          }}
        >
          <Txt variant="caption" tone={result.ok ? 'success' : 'danger'} style={{ flexShrink: 1 }}>
            {resolvedText}
          </Txt>
          {result.link ? (
            <Pressable onPress={() => router.push(actionLinkHref(result.link!))} accessibilityRole="link" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
                {tr('ai.confirm.open_record')}
              </Txt>
              <ExternalLink size={12} color={t.colors.primary} />
            </Pressable>
          ) : null}
        </Row>
      ) : null}

      {pending && actions ? (
        <Row gap={t.spacing.sm} wrap style={{ justifyContent: 'flex-end', padding: t.spacing.sm, borderTopWidth: 1, borderTopColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }}>
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              label={tr('ai.confirm.back')}
              disabled={busy}
              onPress={() => {
                setEditing(false);
                setValues({});
              }}
            />
          ) : (
            <>
              <Button size="sm" variant="ghost" label={tr('ai.confirm.cancel')} icon={<X size={14} color={t.colors.primary} />} disabled={busy} onPress={() => void run(() => actions.cancel(block))} />
              {editable.length ? <Button size="sm" variant="outline" label={tr('ai.confirm.edit')} icon={<Pencil size={14} color={t.colors.text} />} disabled={busy} onPress={() => setEditing(true)} /> : null}
            </>
          )}
          <Button
            size="sm"
            label={editing ? tr('ai.confirm.save_confirm') : tr('ai.confirm.confirm')}
            icon={<Check size={14} color={t.colors.onPrimary} />}
            loading={submitting}
            disabled={busy}
            onPress={() => void run(() => actions.confirm(block, editing ? changedEdits() : undefined))}
          />
        </Row>
      ) : null}
    </View>
  );
}

const PLAN_ICONS = { done: Check, in_progress: CircleDashed, skipped: Minus, pending: Circle } as const;

/** The assistant's plan for a multi-step request (web `PlanBlock`). */
export function PlanBlock({ block }: { block: AIUIBlock }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const plan = block.data as AIPlan | undefined;
  if (!plan?.items?.length) return null;
  const done = plan.items.filter((i) => i.status === 'done').length;
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.md, gap: 6 }}>
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flexShrink: 1 }}>
          <ListChecks size={14} color={t.colors.primary} />
          <Txt variant="caption" style={{ fontWeight: '600', flexShrink: 1 }} accessibilityRole="header">
            {plan.title || tr('ai.plan.title')}
          </Txt>
        </Row>
        <Txt variant="caption" tone="muted" style={{ fontSize: 11 }}>
          {tr('ai.plan.progress', { done, total: plan.items.length })}
        </Txt>
      </Row>
      {plan.items.map((item, i) => {
        const Icon = PLAN_ICONS[item.status] ?? Circle;
        const color = item.status === 'done' ? t.colors.success : item.status === 'in_progress' ? t.colors.primary : t.colors.textMuted;
        return (
          <Row key={`${i}-${item.text}`} gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
            <Icon size={14} color={color} style={{ marginTop: 2 }} />
            <Txt
              variant="caption"
              tone={item.status === 'done' || item.status === 'skipped' ? 'muted' : 'default'}
              style={{ flex: 1, textDecorationLine: item.status === 'done' ? 'line-through' : 'none' }}
              accessibilityLabel={`${item.text}, ${tr(`mobile.ai.plan_status.${item.status}`)}`}
            >
              {item.text}
            </Txt>
          </Row>
        );
      })}
    </View>
  );
}
