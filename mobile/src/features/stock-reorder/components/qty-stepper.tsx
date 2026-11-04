import * as Haptics from 'expo-haptics';
import { Minus, Plus } from 'lucide-react-native';
import { Pressable, TextInput, View } from 'react-native';

import { sanitizeDecimal } from '@/features/sales/components/commerce-parts';
import { useLocale } from '@/lib/i18n/provider';
import { HIT } from '@/theme/tokens';
import { useTheme } from '@/theme/provider';

import { stepQty } from '../lib/reorder';

/** − [qty] + : one unit (or one pack) per tap; the field accepts typing too. */
export function QtyStepper({ value, onChange, packSize, label, disabled }: { value: string; onChange: (v: string) => void; packSize?: string | null; label: string; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const step = (dir: 1 | -1) => {
    Haptics.selectionAsync().catch(() => {});
    onChange(stepQty(value, dir, packSize));
  };
  const btn = (dir: 1 | -1) => (
    <Pressable
      onPress={() => step(dir)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${tr(dir > 0 ? 'mobile.reorder.increase' : 'mobile.reorder.decrease')}`}
      hitSlop={6}
      style={({ pressed }) => ({
        width: HIT,
        height: HIT,
        borderRadius: t.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.colors.surfaceSunken : t.colors.surfaceAlt,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {dir > 0 ? <Plus size={18} color={t.colors.text} /> : <Minus size={18} color={t.colors.text} />}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
      {btn(-1)}
      <TextInput
        value={value}
        onChangeText={(v) => onChange(sanitizeDecimal(v))}
        editable={!disabled}
        keyboardType="decimal-pad"
        inputMode="decimal"
        selectTextOnFocus
        accessibilityLabel={label}
        style={{
          minWidth: 64,
          height: HIT,
          paddingHorizontal: t.spacing.sm,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.surface,
          color: t.colors.text,
          textAlign: 'center',
          fontSize: 16,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}
      />
      {btn(1)}
    </View>
  );
}
