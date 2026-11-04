import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { HIT } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/provider';

// ─── Text ──────────────────────────────────────────────────────────────────

type TxtVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'mono';
type TxtTone = 'default' | 'secondary' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'inverse';

export function Txt({
  variant = 'body',
  tone = 'default',
  style,
  ...rest
}: TextProps & { variant?: TxtVariant; tone?: TxtTone; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  const color = {
    default: t.colors.text,
    secondary: t.colors.textSecondary,
    muted: t.colors.textMuted,
    primary: t.colors.primary,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    info: t.colors.info,
    inverse: t.colors.textInverse,
  }[tone];
  const v: TextStyle = {
    display: { fontSize: t.fontSize.xxxl, fontWeight: t.fontWeight.heavy, letterSpacing: -0.5 },
    title: { fontSize: t.fontSize.xl, fontWeight: t.fontWeight.heavy },
    heading: { fontSize: t.fontSize.lg, fontWeight: t.fontWeight.bold },
    body: { fontSize: t.fontSize.md },
    bodyStrong: { fontSize: t.fontSize.md, fontWeight: t.fontWeight.semibold },
    caption: { fontSize: t.fontSize.sm },
    label: { fontSize: t.fontSize.xs, fontWeight: t.fontWeight.semibold, letterSpacing: 0.4, textTransform: 'uppercase' },
    mono: { fontSize: t.fontSize.md, fontVariant: ['tabular-nums'], fontWeight: t.fontWeight.semibold },
  }[variant] as TextStyle;
  return <Text {...rest} style={[{ color }, v, style]} />;
}

// ─── Button ────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  fullWidth,
  style,
  accessibilityHint,
}: ButtonProps) {
  const t = useTheme();
  const styles = useButtonStyles();
  const palette = {
    primary: { bg: t.colors.primary, fg: t.colors.onPrimary, border: t.colors.primary },
    secondary: { bg: t.colors.primarySoft, fg: t.colors.primary, border: t.colors.primarySoft },
    outline: { bg: t.colors.surface, fg: t.colors.text, border: t.colors.borderStrong },
    ghost: { bg: 'transparent', fg: t.colors.primary, border: 'transparent' },
    danger: { bg: t.colors.danger, fg: '#FFFFFF', border: t.colors.danger },
    success: { bg: t.colors.success, fg: t.scheme === 'dark' ? '#0B1F12' : '#FFFFFF', border: t.colors.success },
  }[variant];
  const isDisabled = disabled || loading;
  const height = size === 'sm' ? 36 : size === 'lg' ? 54 : HIT + 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      hitSlop={size === 'sm' ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        { height, backgroundColor: palette.bg, borderColor: palette.border, paddingHorizontal: size === 'sm' ? t.spacing.md : t.spacing.xl },
        fullWidth && styles.full,
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} size="small" /> : icon}
      <Text
        numberOfLines={1}
        style={[styles.label, { color: palette.fg, fontSize: size === 'sm' ? t.fontSize.sm : t.fontSize.md }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const useButtonStyles = makeStyles((t) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
  },
  full: { alignSelf: 'stretch' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
  label: { fontWeight: t.fontWeight.bold },
}));

// ─── IconButton ────────────────────────────────────────────────────────────

export function IconButton({
  icon,
  onPress,
  label,
  variant = 'surface',
  badge,
  disabled,
  style,
}: {
  icon: ReactNode;
  onPress?: () => void;
  /** Required for screen readers. */
  label: string;
  variant?: 'surface' | 'primary' | 'ghost';
  badge?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.colors.primary : variant === 'ghost' ? 'transparent' : t.colors.surface;
  const border = variant === 'surface' ? t.colors.border : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: t.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {icon}
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: t.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────

export function Card({
  children,
  onPress,
  style,
  padded = true,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: PressableProps['onPress'];
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useCardStyles();
  if (!onPress) return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, padded && styles.padded, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const useCardStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadow.sm,
  },
  padded: { padding: t.spacing.lg },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
}));

// ─── Badge ─────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ label, tone = 'neutral', icon, size = 'md' }: { label: string; tone?: Tone; icon?: ReactNode; size?: 'sm' | 'md' }) {
  const t = useTheme();
  const map = {
    neutral: [t.colors.neutralBg, t.colors.neutral],
    primary: [t.colors.primarySoft, t.colors.primary],
    success: [t.colors.successBg, t.colors.success],
    warning: [t.colors.warningBg, t.colors.warning],
    danger: [t.colors.dangerBg, t.colors.danger],
    info: [t.colors.infoBg, t.colors.info],
  }[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        backgroundColor: map[0],
        borderRadius: t.radius.full,
        paddingHorizontal: size === 'sm' ? 7 : 10,
        paddingVertical: size === 'sm' ? 2 : 4,
      }}
    >
      {icon}
      <Text style={{ color: map[1], fontSize: size === 'sm' ? 11 : 12, fontWeight: '700' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ─── Misc ──────────────────────────────────────────────────────────────────

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.colors.border }, style]} />;
}

export function Row({ children, gap = 8, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Spacer({ size = 16 }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Avatar({ name, size = 36, tone = 'primary' }: { name?: string | null; size?: number; tone?: Tone }) {
  const t = useTheme();
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase('tr-TR'))
    .join('');
  const [bg, fg] =
    tone === 'primary' ? [t.colors.primarySoft, t.colors.primary] : tone === 'info' ? [t.colors.infoBg, t.colors.info] : [t.colors.neutralBg, t.colors.neutral];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: fg, fontWeight: '800', fontSize: size * 0.36 }}>{initials || '?'}</Text>
    </View>
  );
}

/** Turkish licence plate chip. */
export function PlateBadge({ plate, size = 'md' }: { plate: string; size?: 'sm' | 'md' | 'lg' }) {
  const t = useTheme();
  const fs = size === 'sm' ? 11 : size === 'lg' ? 17 : 13;
  return (
    <View
      accessibilityLabel={plate}
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        alignSelf: 'flex-start',
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: t.scheme === 'dark' ? '#5B6B8C' : '#1E3A8A',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
      }}
    >
      <View style={{ backgroundColor: '#1E40AF', paddingHorizontal: 3, justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: fs * 0.55, fontWeight: '800' }}>TR</Text>
      </View>
      <Text
        style={{
          color: '#111',
          fontSize: fs,
          fontWeight: '800',
          letterSpacing: 1,
          paddingHorizontal: size === 'sm' ? 5 : 8,
          paddingVertical: size === 'sm' ? 1 : 3,
          fontVariant: ['tabular-nums'],
        }}
      >
        {plate}
      </Text>
    </View>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
