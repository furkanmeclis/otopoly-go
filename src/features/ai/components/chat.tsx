import { AlertCircle, ArrowUp, Ban, Check, Clock, Sparkles, Square, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { BarChart, Card, RankBars, Row, Txt } from '@/components/ui';
import { ConfirmCard, PlanBlock } from '@/features/ai/components/action-blocks';
import { Markdown } from '@/features/ai/components/markdown';
import { errorKey, isSummaryKey, SUGGESTION_KEYS, toolLabelKey } from '@/features/ai/lib/labels';
import type { AIChart, AIUIBlock, ChatMessage } from '@/features/ai/types';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

// ─── Blocks ──────────────────────────────────────────────────────────────────

function ToolChip({ block }: { block: AIUIBlock }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const status = block.status ?? 'running';
  const params = (block.summary_params ?? {}) as Record<string, string | number>;
  const label = status === 'done' && isSummaryKey(block.summary_key) ? tr(block.summary_key, params) : tr(toolLabelKey(block.name ?? ''));
  const color = status === 'error' ? t.colors.danger : status === 'done' ? t.colors.success : t.colors.textMuted;
  const Icon = status === 'error' ? TriangleAlert : status === 'pending' ? Clock : status === 'cancelled' ? Ban : Check;
  return (
    <View
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: status === 'error' ? t.colors.danger : t.colors.border,
        borderRadius: t.radius.full,
        paddingHorizontal: 10,
        paddingVertical: 4,
        maxWidth: '100%',
      }}
    >
      {status === 'running' ? <ActivityIndicator size="small" color={t.colors.textMuted} /> : <Icon size={13} color={color} />}
      <Txt variant="caption" tone={status === 'error' ? 'danger' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
    </View>
  );
}

function ChartCard({ chart }: { chart: AIChart }) {
  const t = useTheme();
  const { fmt } = useLocale();
  const series = chart.series[0];
  const format = (n: number) => (chart.value_format === 'currency' ? fmt.money(n, chart.currency || 'TRY') : chart.value_format === 'percent' ? `%${fmt.number(n)}` : fmt.number(n));
  const data = chart.rows.map((r) => ({ label: String(r[chart.x_key] ?? ''), value: toNumber(r[series?.key ?? ''] as string | number) }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card style={{ gap: t.spacing.sm }}>
      <Txt variant="bodyStrong">{chart.title}</Txt>
      {series ? (
        <Txt variant="caption" tone="secondary">
          {series.label} · {format(total)}
        </Txt>
      ) : null}
      {chart.type === 'pie' ? (
        <RankBars items={data.map((d) => ({ label: d.label, value: d.value, display: format(d.value) }))} />
      ) : (
        <BarChart data={data} formatValue={format} />
      )}
    </Card>
  );
}

function ErrorBlock({ block }: { block: AIUIBlock }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start', borderWidth: 1, borderColor: t.colors.danger, backgroundColor: t.colors.dangerBg, borderRadius: t.radius.sm, padding: t.spacing.sm }}>
      <AlertCircle size={15} color={t.colors.danger} />
      <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
        {tr(errorKey(block.code))}
      </Txt>
    </Row>
  );
}

function Blocks({ blocks }: { blocks: AIUIBlock[] }) {
  const t = useTheme();
  // Consecutive tool indicators share one wrapped row (same as web MessageBlocks).
  const groups: { key: string; tools?: AIUIBlock[]; block?: AIUIBlock }[] = [];
  blocks.forEach((b, i) => {
    const last = groups[groups.length - 1];
    if (b.type === 'tool') {
      if (b.name === 'update_plan') return;
      if (last?.tools) last.tools.push(b);
      else groups.push({ key: `g${i}`, tools: [b] });
      return;
    }
    groups.push({ key: `b${i}`, block: b });
  });
  return (
    <View style={{ gap: t.spacing.sm }}>
      {groups.map((g) => {
        if (g.tools)
          return (
            <Row key={g.key} wrap gap={6}>
              {g.tools.map((tool, i) => (
                <ToolChip key={tool.id ?? i} block={tool} />
              ))}
            </Row>
          );
        const b = g.block!;
        if (b.type === 'text') return b.text ? <Markdown key={g.key} text={b.text} /> : null;
        if (b.type === 'chart') return b.chart ? <ChartCard key={g.key} chart={b.chart} /> : null;
        if (b.type === 'error') return <ErrorBlock key={g.key} block={b} />;
        if (b.type === 'confirm') return <ConfirmCard key={b.id ?? g.key} block={b} />;
        if (b.type === 'todo_list') return <PlanBlock key={g.key} block={b} />;
        return null;
      })}
    </View>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

export function MessageBubble({ message }: { message: ChatMessage }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  if (message.role === 'user') {
    const text = message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ maxWidth: '85%', backgroundColor: t.colors.primary, borderRadius: t.radius.lg, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9 }}>
          <Txt style={{ color: t.colors.onPrimary }} selectable>
            {text}
          </Txt>
        </View>
      </View>
    );
  }
  if (message.blocks.length === 0 && !message.pending && message.status !== 'cancelled') return null;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <Sparkles size={14} color={t.colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: t.spacing.xs, paddingTop: 3 }}>
        {message.pending ? (
          <Row gap={t.spacing.sm}>
            <ActivityIndicator size="small" color={t.colors.textMuted} />
            <Txt tone="muted">{tr('ai.assistant.thinking')}</Txt>
          </Row>
        ) : (
          <Blocks blocks={message.blocks} />
        )}
        {message.status === 'cancelled' && !message.pending ? (
          <Txt variant="caption" tone="muted" style={{ fontStyle: 'italic' }}>
            {tr('ai.assistant.cancelled')}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

// ─── Empty state with suggestions ────────────────────────────────────────────

export function ChatEmpty({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <View style={{ alignItems: 'center', gap: t.spacing.lg, paddingVertical: t.spacing.xxxl, paddingHorizontal: t.spacing.md }}>
      <View style={{ width: 52, height: 52, borderRadius: t.radius.lg, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Sparkles size={26} color={t.colors.primary} />
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          {tr('ai.assistant.empty_title')}
        </Txt>
        <Txt tone="secondary" style={{ textAlign: 'center' }}>
          {tr('ai.assistant.empty_description')}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.spacing.sm }}>
        {SUGGESTION_KEYS.map((key) => (
          <Pressable
            key={key}
            disabled={disabled}
            onPress={() => onPick(tr(key))}
            accessibilityRole="button"
            style={({ pressed }) => ({
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
              borderRadius: t.radius.full,
              paddingHorizontal: 14,
              paddingVertical: 8,
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <Txt variant="caption">{tr(key)}</Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Composer ────────────────────────────────────────────────────────────────

export function Composer({ onSend, onStop, busy, disabled }: { onSend: (text: string) => void; onStop: () => void; busy: boolean; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [value, setValue] = useState('');
  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue('');
  };
  const canSend = Boolean(value.trim()) && !disabled;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: t.spacing.sm,
        borderWidth: 1.5,
        borderColor: t.colors.border,
        borderRadius: t.radius.lg,
        backgroundColor: t.colors.surface,
        paddingLeft: t.spacing.md,
        paddingRight: 6,
        paddingVertical: 6,
      }}
    >
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={tr('ai.assistant.placeholder')}
        placeholderTextColor={t.colors.textMuted}
        selectionColor={t.colors.primary}
        accessibilityLabel={tr('ai.assistant.placeholder')}
        multiline
        maxLength={4000}
        editable={!disabled}
        submitBehavior="blurAndSubmit"
        onSubmitEditing={submit}
        returnKeyType="send"
        style={{ flex: 1, color: t.colors.text, fontSize: t.fontSize.md, maxHeight: 140, minHeight: 36, paddingTop: 8, paddingBottom: 8 }}
      />
      {busy ? (
        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel={tr('ai.assistant.stop')}
          hitSlop={6}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
        >
          <Square size={14} color={t.colors.text} fill={t.colors.text} />
        </Pressable>
      ) : (
        <Pressable
          onPress={submit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={tr('ai.assistant.send')}
          accessibilityState={{ disabled: !canSend }}
          hitSlop={6}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: canSend ? t.colors.primary : t.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowUp size={18} color={t.colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
}
