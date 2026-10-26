/** WhatsApp / SMS choice (daily summary, vehicle alerts, contract OTP) — web `message-channel-picker.tsx`. */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import type { MessageChannel } from '../services/daily-summary.service';
import { SmsIcon, WhatsAppIcon } from './channel-icons';

export function MessageChannelPicker({
  value,
  onChange,
  smsAvailable,
  disabled,
  hint,
  label,
}: {
  value: MessageChannel;
  onChange: (value: MessageChannel) => void;
  /** The organization has an active SMS provider. */
  smsAvailable: boolean;
  disabled?: boolean;
  hint?: string;
  label?: string;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const options: { value: MessageChannel; label: string; icon: ReactNode; enabled: boolean }[] = [
    { value: 'whatsapp', label: tr('mobile.messaging.channel_picker.whatsapp'), icon: <WhatsAppIcon size={18} />, enabled: true },
    { value: 'sms', label: tr('mobile.messaging.channel_picker.sms'), icon: <SmsIcon size={18} />, enabled: smsAvailable || value === 'sms' },
  ];
  return (
    <View style={{ gap: t.spacing.sm, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: t.spacing.md }}>
      <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
        {label ?? tr('mobile.messaging.channel_picker.label')}
      </Txt>
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const selected = o.value === value;
          const off = disabled || !o.enabled;
          return (
            <Pressable
              key={o.value}
              disabled={off}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected, disabled: off }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: t.spacing.sm,
                minHeight: 44,
                borderRadius: t.radius.md,
                borderWidth: 1.5,
                borderColor: selected ? t.colors.primary : t.colors.border,
                backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
                opacity: off && !selected ? 0.45 : 1,
              }}
            >
              {o.icon}
              <Txt variant="bodyStrong" style={{ color: selected ? t.colors.primary : t.colors.text }}>
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <Txt variant="caption" tone="muted">
        {hint ?? (smsAvailable ? tr('mobile.messaging.channel_picker.hint') : tr('mobile.messaging.channel_picker.sms_unavailable'))}
      </Txt>
    </View>
  );
}
