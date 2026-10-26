/**
 * Building blocks of the 360° detail screens (customer, job, sale, quote, lead, product, service,
 * supplier): one hero card, a stat grid, quick actions and linked-record sections, so every detail
 * screen reads the same way (web entity detail page + section cards).
 */
import * as Haptics from 'expo-haptics';
import { ChevronRight } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { ErrorState, Group, Section, Skeleton } from './layout';
import { Txt, type Tone } from './primitives';

// ─── Hero ──────────────────────────────────────────────────────────────────

/** Top card of a detail screen: leading visual, title, subtitle, badges and an optional trailing value. */
export function DetailHero({
  leading,
  title,
  subtitle,
  badges,
  trailing,
  children,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.colors.surface,
        borderRadius: t.radius.xl,
        borderWidth: 1,
        borderColor: t.colors.border,
        padding: t.spacing.lg,
        gap: t.spacing.md,
        ...t.shadow.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        {leading}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt variant="title" numberOfLines={2} accessibilityRole="header">
            {title}
          </Txt>
          {typeof subtitle === 'string' ? (
            <Txt variant="caption" tone="secondary" numberOfLines={2}>
              {subtitle}
            </Txt>
          ) : (
            subtitle
          )}
        </View>
        {trailing}
      </View>
      {badges ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>{badges}</View> : null}
      {children}
    </View>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export type StatItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone | 'default';
  icon?: ReactNode;
  /** Opens the related list / record. */
  onPress?: () => void;
  loading?: boolean;
};

/** Two-column grid of compact stat tiles (tappable when they lead somewhere). */
export function StatGrid({ items, style }: { items: StatItem[]; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }, style]}>
      {visible.map((s) => (
        <StatTile key={s.label} item={s} />
      ))}
    </View>
  );
}

function StatTile({ item }: { item: StatItem }) {
  const t = useTheme();
  const toneColor =
    item.tone === 'success'
      ? t.colors.success
      : item.tone === 'danger'
        ? t.colors.danger
        : item.tone === 'warning'
          ? t.colors.warning
          : item.tone === 'info'
            ? t.colors.info
            : item.tone === 'primary'
              ? t.colors.primary
              : t.colors.text;
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {item.icon}
        <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {item.label}
        </Txt>
        {item.onPress ? <ChevronRight size={14} color={t.colors.textMuted} /> : null}
      </View>
      {item.loading ? (
        <Skeleton height={20} width={80} />
      ) : (
        <Txt variant="heading" numberOfLines={1} adjustsFontSizeToFit style={{ color: toneColor, fontVariant: ['tabular-nums'] }}>
          {item.value}
        </Txt>
      )}
      {item.hint ? (
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {item.hint}
        </Txt>
      ) : null}
    </>
  );
  const style: ViewStyle = {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 72,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: t.spacing.md,
    gap: 4,
  };
  if (!item.onPress) {
    return (
      <View style={style} accessible accessibilityLabel={`${item.label}: ${item.value}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={item.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.label}: ${item.value}`}
      style={({ pressed }) => [style, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
    >
      {body}
    </Pressable>
  );
}

// ─── Quick actions ─────────────────────────────────────────────────────────

export type QuickAction = { key: string; label: string; icon: ReactNode; onPress: () => void; tone?: 'primary' | 'default'; disabled?: boolean };

/** Row of round action buttons under the hero (call, WhatsApp, SMS, new job…). Wraps on small screens. */
export function QuickActions({ actions }: { actions: (QuickAction | null | false | undefined | '')[] }) {
  const t = useTheme();
  const list = actions.filter(Boolean) as QuickAction[];
  if (!list.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: t.spacing.md }} accessibilityRole="toolbar">
      {list.map((a) => {
        const primary = a.tone === 'primary';
        return (
          <Pressable
            key={a.key}
            disabled={a.disabled}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              a.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            hitSlop={4}
            style={({ pressed }) => ({ alignItems: 'center', gap: 6, minWidth: 64, maxWidth: 88, opacity: a.disabled ? 0.4 : pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: primary ? t.colors.primary : t.colors.primarySoft,
              }}
            >
              {a.icon}
            </View>
            <Txt variant="caption" numberOfLines={2} style={{ textAlign: 'center', fontWeight: '600' }}>
              {a.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Linked records ────────────────────────────────────────────────────────

/**
 * Section of related records with the shared loading / error / empty states. Rows go in `children`
 * (typically `ListRow`s with `onPress` to open the record). `limit` shows the first rows and a
 * "show all" toggle; `action` links to the full list.
 */
export function RelatedSection<T>({
  title,
  items,
  renderItem,
  loading,
  error,
  onRetry,
  empty,
  action,
  limit = 5,
  count,
}: {
  title: string;
  items: T[] | undefined;
  renderItem: (item: T, index: number, last: boolean) => ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: string;
  action?: { label: string; onPress: () => void };
  limit?: number;
  /** Total on the server when only a page is loaded. */
  count?: number;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const list = items ?? [];
  const shown = expanded ? list : list.slice(0, limit);
  const total = count ?? list.length;
  return (
    <Section title={total ? `${title} · ${total}` : title} action={action}>
      {loading && !items ? (
        <Group>
          {[0, 1].map((i) => (
            <View key={i} style={{ padding: t.spacing.lg, gap: 6 }}>
              <Skeleton height={14} width="60%" />
              <Skeleton height={12} width="40%" />
            </View>
          ))}
        </Group>
      ) : error ? (
        <Group>
          <ErrorState error={error} onRetry={onRetry} />
        </Group>
      ) : list.length === 0 ? (
        <Group>
          <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
            {empty}
          </Txt>
        </Group>
      ) : (
        <Group>
          {shown.map((item, i) => renderItem(item, i, i === shown.length - 1 && list.length <= limit))}
          {list.length > limit ? (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              style={({ pressed }) => ({ padding: t.spacing.md, alignItems: 'center', backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent' })}
            >
              <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
                {expanded ? tr('mobile.detail.show_less') : tr('mobile.detail.show_all', { count: list.length })}
              </Txt>
            </Pressable>
          ) : null}
        </Group>
      )}
    </Section>
  );
}

// ─── Refresh ───────────────────────────────────────────────────────────────

/** Pull-to-refresh over several queries: spinner only for the user's pull, not background refetches. */
export function usePullRefresh(...queries: ({ refetch: () => Promise<unknown> } | null | undefined | false)[]) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    Promise.allSettled(queries.filter((q): q is { refetch: () => Promise<unknown> } => Boolean(q)).map((q) => q.refetch())).finally(() => setRefreshing(false));
  };
  return { refreshing, onRefresh };
}

// ─── Links ─────────────────────────────────────────────────────────────────

/** Value that opens the referenced record (customer name, supplier, account…) — for `InfoRow` children. */
export function LinkValue({ label, onPress, leading }: { label: string; onPress?: () => void; leading?: ReactNode }) {
  const t = useTheme();
  if (!onPress) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        {leading}
        <Txt variant="bodyStrong" style={{ flexShrink: 1, textAlign: 'right' }} selectable>
          {label || '—'}
        </Txt>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}
    >
      {leading}
      <Txt variant="bodyStrong" tone="primary" numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>
        {label}
      </Txt>
      <ChevronRight size={14} color={t.colors.primary} />
    </Pressable>
  );
}
