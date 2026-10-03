import { router } from 'expo-router';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Lock, RefreshCw } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocale } from '@/lib/i18n/provider';
import { makeStyles, useTheme } from '@/theme/provider';

import { Button, IconButton, Txt } from './primitives';

// ─── Screen ────────────────────────────────────────────────────────────────

/**
 * Standard screen shell: safe area (top), themed background, optional header,
 * optional scroll with pull-to-refresh. Bottom inset is added to scroll content.
 */
export function Screen({
  children,
  header,
  scroll = true,
  refreshing,
  onRefresh,
  contentStyle,
  footer,
  keyboardShouldPersistTaps = 'handled',
  edges = ['top'],
}: {
  children: ReactNode;
  header?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  edges?: ('top' | 'bottom')[];
}) {
  const t = useTheme();
  const styles = useScreenStyles();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {header}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + t.spacing.xxxl }, contentStyle]}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={t.colors.primary} colors={[t.colors.primary]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, t.spacing.md) }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const useScreenStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, gap: t.spacing.lg },
  footer: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface,
    gap: t.spacing.sm,
  },
}));

// ─── Header ────────────────────────────────────────────────────────────────

export function Header({
  title,
  subtitle,
  back = true,
  onBack,
  right,
  large,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingTop: t.spacing.sm,
        paddingBottom: t.spacing.md,
      }}
    >
      {back ? (
        <IconButton
          label={tr('common.back')}
          icon={<ChevronLeft size={22} color={t.colors.text} />}
          onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant={large ? 'display' : 'title'} numberOfLines={1} accessibilityRole="header">
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>{right}</View> : null}
    </View>
  );
}

// ─── Sections ──────────────────────────────────────────────────────────────

export function Section({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ gap: t.spacing.sm }, style]}>
      {title || action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}>
          {title ? (
            <Txt variant="heading" accessibilityRole="header">
              {title}
            </Txt>
          ) : (
            <View />
          )}
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
              <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
                {action.label}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Grouped list container (iOS settings style). */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          borderWidth: 1,
          borderColor: t.colors.border,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  value,
  onPress,
  chevron,
  destructive,
  last,
  disabled,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string | null;
  left?: ReactNode;
  right?: ReactNode;
  value?: string | null;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  last?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        minHeight: 52,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="bodyStrong" tone={destructive ? 'danger' : 'default'} numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ maxWidth: '45%', textAlign: 'right' }}>
          {value}
        </Txt>
      ) : null}
      {right}
      {chevron || (onPress && chevron !== false) ? <ChevronRight size={18} color={t.colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({ backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}

/** Label / value pair for detail screens. */
export function InfoRow({ label, value, last, children }: { label: string; value?: string | null; last?: boolean; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingVertical: t.spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.border,
      }}
    >
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
      {children ?? (
        <Txt variant="bodyStrong" style={{ flexShrink: 1, textAlign: 'right' }} selectable>
          {value || '—'}
        </Txt>
      )}
    </View>
  );
}

// ─── States ────────────────────────────────────────────────────────────────

function StateBlock({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: t.spacing.xxxl, paddingHorizontal: t.spacing.xl, gap: t.spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: t.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <Txt variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {description ? (
        <Txt variant="caption" tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>
          {description}
        </Txt>
      ) : null}
      {action}
    </View>
  );
}

export function EmptyState({ title, description, icon, action }: { title?: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <StateBlock
      icon={icon ?? <Inbox size={28} color={t.colors.textMuted} />}
      title={title ?? tr('common.empty_title')}
      description={description ?? tr('common.empty_description')}
      action={action}
    />
  );
}

export function ErrorState({ description, onRetry }: { description?: string; onRetry?: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <StateBlock
      icon={<AlertTriangle size={28} color={t.colors.danger} />}
      title={tr('common.error_generic')}
      description={description}
      action={onRetry ? <Button label={tr('common.retry')} variant="outline" size="sm" icon={<RefreshCw size={16} color={t.colors.text} />} onPress={onRetry} /> : null}
    />
  );
}

export function ForbiddenState({ description }: { description?: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <StateBlock
      icon={<Lock size={28} color={t.colors.warning} />}
      title={tr('errors.forbidden_title')}
      description={description ?? tr('common.error_forbidden')}
    />
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────

export function Skeleton({ height = 16, width = '100%', radius = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
    // Infinite animation: stop it explicitly when the placeholder goes away.
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: t.colors.skeleton }, animated, style]} />;
}

export function ListSkeleton({ rows = 5, height = 72 }: { rows?: number; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }} accessibilityLabel="loading" accessible>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={t.radius.lg} />
      ))}
    </View>
  );
}
