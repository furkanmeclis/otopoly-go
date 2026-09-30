/** Small building blocks shared by the CRM screens (todos, leads, quotes). */
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ListRow, Sheet, Txt, type Tone } from '@/components/ui';
import { useTheme } from '@/theme/provider';

/** Pill toggle (web `rounded-full border` buttons: sources, presets, quick dates). */
export function Chip({
  label,
  active,
  onPress,
  disabled,
  icon,
  tone = 'primary',
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  tone?: Tone;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const fg = { neutral: t.colors.neutral, primary: t.colors.primary, success: t.colors.success, warning: t.colors.warning, danger: t.colors.danger, info: t.colors.info }[tone];
  const bg = { neutral: t.colors.neutralBg, primary: t.colors.primarySoft, success: t.colors.successBg, warning: t.colors.warningBg, danger: t.colors.dangerBg, info: t.colors.infoBg }[tone];
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minHeight: 34,
        paddingHorizontal: t.spacing.md,
        borderRadius: t.radius.full,
        borderWidth: 1,
        borderColor: active ? fg : t.colors.border,
        backgroundColor: active ? bg : t.colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      {icon}
      <Txt variant="caption" style={{ fontWeight: '700', color: active ? fg : t.colors.textSecondary }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>{children}</View>;
}

export type MenuAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** "More actions" bottom sheet (web DropdownMenu). Hidden actions are simply omitted by the caller. */
export function ActionMenu({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title: string; actions: MenuAction[] }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden' }}>
        {actions.map((a, i) => (
          <ListRow
            key={a.key}
            title={a.label}
            left={a.icon}
            destructive={a.destructive}
            disabled={a.disabled}
            chevron={false}
            last={i === actions.length - 1}
            onPress={() => {
              onClose();
              // Let the sheet dismiss before the action opens another sheet.
              setTimeout(a.onPress, 350);
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}

/** Progress bar stepper (web LeadStepper / QuoteStepper). */
export function Stepper<T extends string>({
  steps,
  current,
  doneUntil,
  label,
  successStep,
  muted,
  onStep,
}: {
  steps: T[];
  current: T;
  /** Index of the last completed step (-1: none). */
  doneUntil: number;
  label: (step: T) => string;
  /** Step drawn in the success colour when done. */
  successStep?: T;
  /** Terminal failure: bars tinted danger. */
  muted?: boolean;
  onStep?: (step: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="progressbar">
      {steps.map((step, i) => {
        const done = i <= doneUntil;
        const isCurrent = step === current;
        const color = muted ? t.colors.dangerBg : done ? (step === successStep ? t.colors.success : t.colors.primary) : t.colors.surfaceSunken;
        return (
          <Pressable
            key={step}
            disabled={!onStep || isCurrent}
            onPress={() => onStep?.(step)}
            accessibilityRole={onStep ? 'button' : 'text'}
            accessibilityState={{ selected: isCurrent }}
            accessibilityLabel={label(step)}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ height: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: color }} />
            <Txt variant="caption" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 11, fontWeight: done ? '700' : '500', color: done && !muted ? t.colors.primary : t.colors.textMuted }}>
              {label(step)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Soft coloured notice box (web `bg-amber-500/10` hints, decision banners). */
export function Notice({ tone, icon, title, children }: { tone: Tone; icon?: ReactNode; title?: string; children?: ReactNode }) {
  const t = useTheme();
  const fg = { neutral: t.colors.textSecondary, primary: t.colors.primary, success: t.colors.success, warning: t.colors.warning, danger: t.colors.danger, info: t.colors.info }[tone];
  const bg = { neutral: t.colors.neutralBg, primary: t.colors.primarySoft, success: t.colors.successBg, warning: t.colors.warningBg, danger: t.colors.dangerBg, info: t.colors.infoBg }[tone];
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: bg }}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Txt variant="bodyStrong" style={{ color: fg }}>
            {title}
          </Txt>
        ) : null}
        {typeof children === 'string' ? (
          <Txt variant="caption" style={{ color: fg }}>
            {children}
          </Txt>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
