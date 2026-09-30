/** Web `SignerSlotsEditor`: who signs the contract (customer / staff / custom), required flag, add/remove. */
import { Plus, Trash2 } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, Card, IconButton, Row, SelectField, SwitchRow, TextField, Txt } from '@/components/ui';
import type { SignerSlot } from '@/features/contract-presets/services/contract-presets.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const ROLES = ['customer', 'staff', 'custom'] as const;

function roleSelectValue(role: string) {
  return role === 'customer' || role === 'staff' ? role : 'custom';
}

export function SignerSlotsEditor({ value, onChange, disabled = false }: { value: SignerSlot[]; onChange: (slots: SignerSlot[]) => void; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();

  const update = (index: number, slot: SignerSlot) => {
    const next = [...value];
    next[index] = slot;
    onChange(next);
  };

  return (
    <View style={{ gap: t.spacing.md }}>
      <Txt variant="caption" tone="secondary">
        {tr('contracts.fields.signer_slots_hint')}
      </Txt>
      {value.map((slot, index) => {
        const selectValue = roleSelectValue(slot.role);
        return (
          <Card key={index} style={{ gap: t.spacing.md }}>
            <Row gap={t.spacing.sm} style={{ alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <SelectField
                  label={tr('contracts.fields.signer_type')}
                  value={selectValue}
                  disabled={disabled}
                  options={ROLES.map((r) => ({ value: r, label: tr(`contracts.signer_roles.${r}`) }))}
                  onChange={(next) => {
                    if (next === 'customer' || next === 'staff') {
                      update(index, { ...slot, role: next, label: tr(`contracts.signer_roles.${next}`) });
                    } else if (next === 'custom') {
                      update(index, {
                        ...slot,
                        role: slot.role === 'customer' || slot.role === 'staff' ? 'other' : slot.role || 'other',
                        label: slot.label || tr('contracts.signer_roles.custom'),
                      });
                    }
                  }}
                />
              </View>
              {!disabled ? (
                <IconButton
                  label={tr('contracts.fields.remove_slot')}
                  variant="ghost"
                  disabled={value.length <= 1}
                  icon={<Trash2 size={18} color={value.length <= 1 ? t.colors.textMuted : t.colors.danger} />}
                  onPress={() => onChange(value.filter((_, i) => i !== index))}
                />
              ) : null}
            </Row>
            {selectValue === 'custom' ? (
              <TextField
                label={tr('contracts.fields.label')}
                value={slot.label}
                editable={!disabled}
                placeholder={tr('contracts.fields.label_placeholder')}
                onChangeText={(label) => update(index, { ...slot, label, role: label.trim().toLowerCase().replace(/\s+/g, '_') || 'other' })}
              />
            ) : null}
            <SwitchRow label={tr('contracts.fields.required')} value={slot.required} disabled={disabled} onValueChange={(required) => update(index, { ...slot, required })} />
          </Card>
        );
      })}
      {!disabled ? (
        <Button
          variant="outline"
          size="sm"
          label={tr('contracts.fields.add_slot')}
          icon={<Plus size={16} color={t.colors.text} />}
          onPress={() => onChange([...value, { role: 'customer', label: tr('contracts.signer_roles.customer'), required: true }])}
        />
      ) : null}
    </View>
  );
}
