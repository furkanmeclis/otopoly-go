import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
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

// ─── Charts (SVG, theme-aware, touch tooltips) ────────────────────────────
//
// Every chart answers touch the same way (web hover): tap or drag across it to highlight the bar /
// point under the finger and show its label + value in a tooltip; a haptic tick marks each change.
// A horizontal drag scrubs (a vertical one still scrolls the screen); the tooltip goes away on release,
// on a second tap of the same item or after a few seconds.

const HIDE_AFTER_DRAG_MS = 1200;
const HIDE_AFTER_TAP_MS = 4000;

/** Touch selection over `count` evenly spaced items laid out across the chart width. */
function useChartSelection(count: number, mapX: (x: number, width: number, count: number) => number) {
  const [active, setActive] = useState<number | null>(null);
  const width = useRef(0);
  const countRef = useRef(count);
  const activeRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    countRef.current = count;
  }, [count]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const { tapConfig, panConfig } = useMemo(() => {
    const clearTimer = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const select = (index: number | null) => {
      if (index === activeRef.current) return;
      activeRef.current = index;
      setActive(index);
      if (index != null) Haptics.selectionAsync().catch(() => {});
    };
    const hideLater = (ms: number) => {
      clearTimer();
      timer.current = setTimeout(() => select(null), ms);
    };
    const indexAt = (x: number) => {
      const n = countRef.current;
      if (!n || width.current <= 0) return null;
      return Math.max(0, Math.min(n - 1, mapX(x, width.current, n)));
    };
    return {
      tapConfig: {
        runOnJS: true,
        onActivate: (e: { x: number }) => {
          const index = indexAt(e.x);
          if (index != null && index === activeRef.current) {
            clearTimer();
            select(null);
            return;
          }
          select(index);
          hideLater(HIDE_AFTER_TAP_MS);
        },
      },
      panConfig: {
        runOnJS: true,
        // Horizontal scrub; a vertical drag fails the pan so the screen keeps scrolling.
        activeOffsetX: [-6, 6] as [number, number],
        failOffsetY: [-12, 12] as [number, number],
        onActivate: (e: { x: number }) => {
          clearTimer();
          select(indexAt(e.x));
        },
        onUpdate: (e: { x: number }) => select(indexAt(e.x)),
        onFinalize: () => {
          if (activeRef.current != null) hideLater(HIDE_AFTER_DRAG_MS);
        },
      },
    };
  }, [mapX]);
  const tap = useTapGesture(tapConfig);
  const pan = usePanGesture(panConfig);
  const gesture = useCompetingGestures(pan, tap);
  return {
    active: active != null && active < count ? active : null,
    gesture,
    onLayout: (e: LayoutChangeEvent) => {
      width.current = e.nativeEvent.layout.width;
    },
  };
}

const barIndexAt = (x: number, width: number, n: number) => Math.floor((x / width) * n);
const pointIndexAt = (x: number, width: number, n: number) => Math.round((x / width) * (n - 1));

export type ChartTooltipLine = { label?: string; value: string; color?: string };

/** Floating tooltip anchored at `x` (px from the chart's left edge), kept inside the chart. */
export function ChartTooltip({ x, width, title, lines }: { x: number; width: number; title: string; lines: ChartTooltipLine[] }) {
  const t = useTheme();
  // Open towards the roomier side so it never leaves the chart.
  const side = x > width / 2 ? { right: Math.max(0, width - x + 8) } : { left: Math.max(0, x + 8) };
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top: 0,
        ...side,
        maxWidth: Math.max(140, width * 0.62),
        backgroundColor: t.colors.surface,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.colors.border,
        paddingHorizontal: t.spacing.md,
        paddingVertical: t.spacing.sm,
        gap: 2,
        ...t.shadow.md,
      }}
    >
      <Txt variant="caption" tone="secondary" numberOfLines={1}>
        {title}
      </Txt>
      {lines.map((l, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {l.color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: l.color }} /> : null}
          {l.label ? (
            <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {l.label}
            </Txt>
          ) : null}
          <Txt variant="bodyStrong" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
            {l.value}
          </Txt>
        </View>
      ))}
    </View>
  );
}

export type BarDatum = {
  /** Axis label (short date). */
  label: string;
  value: number;
  secondary?: number;
  /** Tooltip title; defaults to `label` (e.g. the full date). */
  title?: string;
};

export function BarChart({
  data,
  height = 140,
  color,
  secondary,
  formatValue,
  seriesLabels,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  /** Optional overlaid second series (e.g. expense). */
  secondary?: string;
  formatValue?: (n: number) => string;
  /** Tooltip names of the two series (e.g. income / expense). */
  seriesLabels?: { primary?: string; secondary?: string };
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { active, gesture, onLayout } = useChartSelection(data.length, barIndexAt);
  const [chartWidth, setChartWidth] = useState(0);
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)));
  const barColor = color ?? t.colors.primary;
  const n = data.length || 1;
  const gap = n > 20 ? 2 : 4;
  const w = 320;
  const barW = (w - gap * (n - 1)) / n;
  const fmtValue = formatValue ?? ((v: number) => String(v));
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0] ?? { label: '', value: 0 });
  const selected = active != null ? data[active] : null;
  const tooltipX = active != null ? ((active * (barW + gap) + barW / 2) / w) * chartWidth : 0;
  return (
    <View
      accessible
      accessibilityLabel={peak ? `max ${fmtValue(peak.value)}` : undefined}
      accessibilityHint={tr('mobile.charts.touch_hint')}
    >
      <GestureDetector gesture={gesture}>
        <View
          collapsable={false}
          onLayout={(e) => {
            onLayout(e);
            setChartWidth(e.nativeEvent.layout.width);
          }}
          style={{ height }}
        >
          <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
            <Line x1={0} y1={height - 0.5} x2={w} y2={height - 0.5} stroke={t.colors.border} strokeWidth={1} />
            {active != null ? (
              <Rect x={active * (barW + gap) - gap / 2} y={0} width={barW + gap} height={height} fill={t.colors.surfaceAlt} />
            ) : null}
            {data.map((d, i) => {
              const h = (d.value / max) * (height - 8);
              const x = i * (barW + gap);
              const sh = d.secondary != null ? (d.secondary / max) * (height - 8) : 0;
              const dim = active != null && active !== i;
              return (
                <G key={i} opacity={dim ? 0.35 : 1}>
                  <Rect x={x} y={height - h} width={barW} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={Math.min(3, barW / 2)} fill={barColor} />
                  {secondary && d.secondary != null ? (
                    <Rect x={x + barW * 0.25} y={height - sh} width={barW * 0.5} height={Math.max(sh, d.secondary > 0 ? 2 : 0)} rx={1.5} fill={secondary} opacity={0.9} />
                  ) : null}
                </G>
              );
            })}
          </Svg>
          {selected ? (
            <ChartTooltip
              x={tooltipX}
              width={chartWidth}
              title={selected.title ?? selected.label}
              lines={[
                { label: seriesLabels?.primary, value: fmtValue(selected.value), color: barColor },
                ...(secondary && selected.secondary != null ? [{ label: seriesLabels?.secondary, value: fmtValue(selected.secondary), color: secondary }] : []),
              ]}
            />
          ) : null}
        </View>
      </GestureDetector>
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

export function Sparkline({
  values,
  height = 36,
  color,
  labels,
  formatValue,
  seriesLabel,
}: {
  values: number[];
  height?: number;
  color?: string;
  /** Tooltip title per point (e.g. dates). Without labels and formatter the line is static. */
  labels?: string[];
  formatValue?: (n: number) => string;
  seriesLabel?: string;
}) {
  const t = useTheme();
  const { active, gesture, onLayout } = useChartSelection(values.length, pointIndexAt);
  const [chartWidth, setChartWidth] = useState(0);
  if (values.length < 2) return <View style={{ height }} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const w = 100;
  const lineColor = color ?? t.colors.primary;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - ((v - min) / (max - min || 1)) * (height - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const interactive = Boolean(labels || formatValue);
  const svg = (
    <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      {active != null ? <Line x1={pts[active][0]} y1={0} x2={pts[active][0]} y2={height} stroke={t.colors.borderStrong} strokeWidth={0.6} strokeDasharray="2,2" /> : null}
      <Path d={d} stroke={lineColor} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
  if (!interactive) return svg;
  const point = active != null ? pts[active] : null;
  const px = point ? (point[0] / w) * chartWidth : 0;
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        onLayout={(e) => {
          onLayout(e);
          setChartWidth(e.nativeEvent.layout.width);
        }}
        style={{ height, overflow: 'visible' }}
      >
        {svg}
        {point && active != null ? (
          <>
            {/* Circle outside the stretched SVG so it stays round. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: px - 5,
                top: point[1] - 5,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: lineColor,
                borderWidth: 2,
                borderColor: t.colors.surface,
              }}
            />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: height + 4 }}>
              <ChartTooltip
                x={px}
                width={chartWidth}
                title={labels?.[active] ?? ''}
                lines={[{ label: seriesLabel, value: formatValue ? formatValue(values[active]) : String(values[active]), color: lineColor }]}
              />
            </View>
          </>
        ) : null}
      </View>
    </GestureDetector>
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
