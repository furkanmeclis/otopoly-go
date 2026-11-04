import { router } from 'expo-router';
import { AlertTriangle, Check } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Badge, Txt } from '@/components/ui';
import { encodeQr } from '@/features/messaging/lib/qr';
import { useTheme } from '@/theme/provider';
import { lightColors } from '@/theme/tokens';

/** Checkbox row (the UI kit has no checkbox; used for recipients, events and services). */
export function CheckRow({
  label,
  description,
  checked,
  onToggle,
  disabled,
  right,
  last,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  right?: ReactNode;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingVertical: t.spacing.md,
        paddingHorizontal: t.spacing.md,
        minHeight: 48,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.border,
        backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: checked ? t.colors.primary : t.colors.borderStrong,
          backgroundColor: checked ? t.colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Check size={15} color={t.colors.onPrimary} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt numberOfLines={1}>{label}</Txt>
        {description ? (
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {description}
          </Txt>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Amber notice box (web `border-amber-500/30 bg-amber-500/10`). */
export function WarningNote({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start', padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.warningBg }}>
      <AlertTriangle size={16} color={t.colors.warning} style={{ marginTop: 2 }} />
      <Txt variant="caption" tone="warning" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

/** "No phone" hint with a link to the profile's notification settings. */
export function ProfileHint({ text, link }: { text: string; link: string }) {
  return (
    <Txt variant="caption" tone="warning">
      {text}{' '}
      <Txt variant="caption" tone="primary" style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/profile')} accessibilityRole="link">
        {link}
      </Txt>
    </Txt>
  );
}

export function RoleBadge({ owner, ownerLabel, staffLabel }: { owner: boolean; ownerLabel: string; staffLabel: string }) {
  return <Badge size="sm" tone="neutral" label={owner ? ownerLabel : staffLabel} />;
}

/**
 * QR drawn with react-native-svg. Always dark-on-light (independent of the app theme) so phone
 * cameras can read it; the quiet zone is 2 modules like the web (`margin: 2`).
 */
export function QrCode({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const matrix = useMemo(() => encodeQr(value), [value]);
  const n = matrix.length + 4;
  const d = useMemo(() => {
    let path = '';
    matrix.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x + 2} ${y + 2}h1v1h-1z`)));
    return path;
  }, [matrix]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ borderRadius: 8, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
        <Rect x={0} y={0} width={n} height={n} fill={lightColors.surface} />
        <Path d={d} fill={lightColors.text} />
      </Svg>
    </View>
  );
}
