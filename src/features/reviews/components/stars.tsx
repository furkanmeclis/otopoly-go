import { Star } from 'lucide-react-native';
import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { useTheme } from '@/theme/provider';

/** Read-only 1–5 stars (filled = warning token). Announced as "n/5" to screen readers. */
export function Stars({ score, size = 14 }: { score: number | null | undefined; size?: number }) {
  const t = useTheme();
  if (!score) {
    return (
      <Txt variant="caption" tone="muted">
        —
      </Txt>
    );
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${score}/5`} style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} color={i <= score ? t.colors.warning : t.colors.border} fill={i <= score ? t.colors.warning : 'transparent'} />
      ))}
    </View>
  );
}
