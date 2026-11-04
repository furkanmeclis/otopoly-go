import { Pressable, View } from 'react-native';

import { Row, Txt } from '@/components/ui';
import { resolveServiceColor, SERVICE_COLORS, serviceSwatch } from '@/features/catalog/lib/service-colors';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Web `ServiceColorField`: "auto" (derived from the name) or one of the palette keys, with a live tag preview. */
export function ServiceColorPicker({ value, name, onChange }: { value: string; name: string; onChange: (v: string) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const effective = resolveServiceColor(value, name);
  const preview = serviceSwatch(effective, name, t.scheme);
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('catalog.services.color')}
        </Txt>
        <View style={{ borderRadius: t.radius.full, paddingHorizontal: t.spacing.sm, paddingVertical: 2, backgroundColor: preview.bg }}>
          <Txt variant="caption" numberOfLines={1} style={{ color: preview.text, fontWeight: '600', maxWidth: 180 }}>
            {name.trim() || tr('catalog.services.color_preview')}
          </Txt>
        </View>
      </Row>
      <Row gap={t.spacing.sm} wrap>
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === '' }}
          style={{
            height: 32,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radius.full,
            borderWidth: 1.5,
            borderColor: value === '' ? t.colors.primary : t.colors.border,
            justifyContent: 'center',
          }}
        >
          <Txt variant="caption" tone={value === '' ? 'default' : 'secondary'}>
            {tr('catalog.services.color_auto')}
          </Txt>
        </Pressable>
        {SERVICE_COLORS.map((key) => {
          const selected = value === key;
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              accessibilityRole="radio"
              accessibilityLabel={key}
              accessibilityState={{ selected }}
              hitSlop={4}
              style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: selected ? t.colors.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: serviceSwatch(key, name, t.scheme).solid }} />
            </Pressable>
          );
        })}
      </Row>
      <Txt variant="caption" tone="muted">
        {tr('catalog.services.color_hint')}
      </Txt>
    </View>
  );
}
