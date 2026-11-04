import { BellRing, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Field, IconButton, Segmented, TextField, Txt } from '@/components/ui';
import { Chip, ChipRow } from '@/features/leads/components/crm-ui';
import { MAX_OFFSET_MINUTES, MAX_REMINDERS, PRESET_OFFSETS, offsetLabel, sortOffsets } from '@/features/todos/lib/reminders';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

/** Web `todos/components/reminder-picker.tsx`: presets + custom offsets, max 5. */
export function ReminderPicker({ value, onChange, disabled, hasTime }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean; hasTime: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [customOpen, setCustomOpen] = useState(false);
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState<Unit>('minutes');
  const full = value.length >= MAX_REMINDERS;
  const custom = value.filter((v) => !(PRESET_OFFSETS as readonly number[]).includes(v));

  const toggle = (minutes: number) => {
    if (value.includes(minutes)) onChange(value.filter((v) => v !== minutes));
    else if (!full) onChange(sortOffsets([...value, minutes]));
  };
  const addCustom = () => {
    const n = Number.parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const minutes = Math.min(n * UNIT_MINUTES[unit], MAX_OFFSET_MINUTES);
    if (!value.includes(minutes) && !full) onChange(sortOffsets([...value, minutes]));
    setCustomOpen(false);
  };
  const hint = disabled ? tr('todos.reminders.need_date') : full ? tr('todos.reminders.max') : !hasTime ? tr('todos.reminders.date_only_hint') : null;

  return (
    <Field label={tr('todos.fields.reminders')}>
      <ChipRow>
        {PRESET_OFFSETS.map((minutes) => {
          const on = value.includes(minutes);
          return (
            <Chip
              key={minutes}
              label={offsetLabel(tr, minutes)}
              active={on}
              disabled={disabled || (!on && full)}
              icon={on ? <BellRing size={12} color={t.colors.primary} /> : undefined}
              onPress={() => toggle(minutes)}
            />
          );
        })}
        {custom.map((minutes) => (
          <Chip
            key={minutes}
            label={offsetLabel(tr, minutes)}
            active
            disabled={disabled}
            icon={<X size={12} color={t.colors.primary} />}
            accessibilityLabel={`${tr('todos.reminders.remove')}: ${offsetLabel(tr, minutes)}`}
            onPress={() => toggle(minutes)}
          />
        ))}
        {!customOpen ? <Chip label={tr('todos.reminders.custom')} icon={<Plus size={12} color={t.colors.textSecondary} />} disabled={disabled || full} onPress={() => setCustomOpen(true)} /> : null}
      </ChipRow>
      {customOpen && !disabled ? (
        <View style={{ gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <View style={{ width: 90 }}>
              <TextField value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" accessibilityLabel={tr('todos.reminders.custom')} />
            </View>
            <View style={{ flex: 1 }}>
              <Segmented<Unit>
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'minutes', label: tr('todos.reminders.unit_minutes') },
                  { value: 'hours', label: tr('todos.reminders.unit_hours') },
                  { value: 'days', label: tr('todos.reminders.unit_days') },
                ]}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' }}>
            <Button size="sm" label={tr('todos.reminders.custom_add')} onPress={addCustom} style={{ flex: 1 }} />
            <IconButton label={tr('common.cancel')} icon={<X size={18} color={t.colors.text} />} onPress={() => setCustomOpen(false)} />
          </View>
        </View>
      ) : null}
      {hint ? (
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      ) : null}
    </Field>
  );
}
