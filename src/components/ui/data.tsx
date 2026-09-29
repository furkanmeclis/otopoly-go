import type { ReactNode } from 'react';
import { Alert, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G, Line, Path, Rect } from 'react-native-svg';

import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { translate, type AppLocale } from '@/lib/i18n/translate';
import { useTheme } from '@/theme/provider';

import { Txt, type Tone } from './primitives';

// ─── Money ─────────────────────────────────────────────────────────────────

export function Amount({
  value,
  currency = 'TRY',
  variant = 'mono',
  tone,
  signed,
  compact,
}: {
  value: string | number | null | undefined;
  currency?: string;
  variant?: 'mono' | 'title' | 'display' | 'caption';
  tone?: 'default' | 'success' | 'danger' | 'secondary' | 'muted' | 'primary';
  signed?: boolean;
  compact?: boolean;
}) {
  const { fmt } = useLocale();
  const n = toNumber(value);
  const text = compact ? fmt.moneyCompact(n, currency) : fmt.money(n, currency);
  const autoTone = signed ? (n > 0 ? 'success' : n < 0 ? 'danger' : 'default') : 'default';
  const size = variant === 'display' ? 'display' : variant === 'title' ? 'title' : variant === 'caption' ? 'caption' : 'mono';
  return (
    <Txt variant={size} tone={tone ?? autoTone} style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
      {signed && n > 0 ? '+' : ''}
      {text}
    </Txt>
  );
}

// ─── KPI ───────────────────────────────────────────────────────────────────

export function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  style,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const accent = {
    neutral: t.colors.surfaceAlt,
    primary: t.colors.primarySoft,
    success: t.colors.successBg,
    warning: t.colors.warningBg,
    danger: t.colors.dangerBg,
    info: t.colors.infoBg,
  }[tone];
  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 140,
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          borderWidth: 1,
          borderColor: t.colors.border,
          padding: t.spacing.md,
          gap: 6,
          ...t.shadow.sm,
        },
        style,
      ]}
      accessible
      accessibilityLabel={`${label}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        {icon ? (
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
        ) : null}
        <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Txt>
      </View>
      {typeof value === 'string' ? (
        <Txt variant="title" numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Txt>
      ) : (
        value
      )}
      {hint ? (
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ─── Charts (SVG, theme-aware) ─────────────────────────────────────────────

export function BarChart({
  data,
  height = 140,
  color,
  secondary,
  formatValue,
}: {
  data: { label: string; value: number; secondary?: number }[];
  height?: number;
  color?: string;
  /** Optional overlaid second series (e.g. expense). */
  secondary?: string;
  formatValue?: (n: number) => string;
}) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)));
  const barColor = color ?? t.colors.primary;
  const n = data.length || 1;
  const gap = n > 20 ? 2 : 4;
  const w = 320;
  const barW = (w - gap * (n - 1)) / n;
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { label: '', value: 0 });
  return (
    <View accessible accessibilityLabel={peak ? `max ${formatValue ? formatValue(peak.value) : peak.value}` : undefined}>
      <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
        <Line x1={0} y1={height - 0.5} x2={w} y2={height - 0.5} stroke={t.colors.border} strokeWidth={1} />
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 8);
          const x = i * (barW + gap);
          const sh = d.secondary != null ? (d.secondary / max) * (height - 8) : 0;
          return (
            <G key={i}>
              <Rect x={x} y={height - h} width={barW} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={Math.min(3, barW / 2)} fill={barColor} />
              {secondary && d.secondary != null ? (
                <Rect x={x + barW * 0.25} y={height - sh} width={barW * 0.5} height={Math.max(sh, d.secondary > 0 ? 2 : 0)} rx={1.5} fill={secondary} opacity={0.9} />
              ) : null}
            </G>
          );
        })}
      </Svg>
      {data.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Txt variant="caption" tone="muted">
            {data[0].label}
          </Txt>
          <Txt variant="caption" tone="muted">
            {data[data.length - 1].label}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

export function Sparkline({ values, height = 36, color }: { values: number[]; height?: number; color?: string }) {
  const t = useTheme();
  if (values.length < 2) return <View style={{ height }} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 100;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - ((v - min) / (max - min || 1)) * (height - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <Path d={d} stroke={color ?? t.colors.primary} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/** Horizontal proportion bars (top services, expense categories…). */
export function RankBars({ items, color }: { items: { label: string; value: number; display: string; sub?: string }[]; color?: string }) {
  const t = useTheme();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={{ gap: t.spacing.md }}>
      {items.map((i, idx) => (
        <View key={`${i.label}-${idx}`} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {i.label}
            </Txt>
            <Txt variant="mono">{i.display}</Txt>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(3, (i.value / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: color ?? t.colors.chart[idx % t.colors.chart.length] }} />
          </View>
          {i.sub ? (
            <Txt variant="caption" tone="muted">
              {i.sub}
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ─── Confirm ───────────────────────────────────────────────────────────────

/** Native confirm dialog (Alert) — reliable, accessible, platform-styled. */
export function confirm({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  locale,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  locale: AppLocale;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel ?? translate(locale, 'common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel ?? translate(locale, 'common.confirm'), style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function useConfirm() {
  const { locale } = useLocale();
  return (opts: Omit<Parameters<typeof confirm>[0], 'locale'>) => confirm({ ...opts, locale });
}
