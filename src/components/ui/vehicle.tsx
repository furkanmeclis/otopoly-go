import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { apiUrl } from '@/api/files';
import { useTheme } from '@/theme/provider';

import { Txt } from './primitives';

const SIZES = { xs: 20, sm: 28, md: 36, lg: 48 } as const;
export type BrandLogoSize = keyof typeof SIZES;

/** Compact (emblem) variant of an API-owned brand logo URL, as the web `BrandMark` requests it. */
function badgeSrc(url: string) {
  return apiUrl(`${url}${url.includes('?') ? '&' : '?'}variant=badge`);
}

function monogram(name: string) {
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '').slice(0, 2);
  return letters.toLocaleUpperCase('tr-TR') || '?';
}

/**
 * Vehicle brand logo (web `BrandMark`): the API-owned `logo_url` / `brand_logo_url` on a white tile,
 * falling back to a monogram when there is no logo or it fails to load. Images are cached on disk and
 * in memory by expo-image, so lists and pickers don't refetch them.
 */
export function BrandLogo({ name, logoUrl, size = 'sm', style }: { name?: string | null; logoUrl?: string | null; size?: BrandLogoSize; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const label = name?.trim() ?? '';
  if (!label && !logoUrl) return null;
  const px = SIZES[size];
  const showImage = Boolean(logoUrl) && failed !== logoUrl;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: px,
          height: px,
          borderRadius: Math.round(px * 0.25),
          borderWidth: 1,
          borderColor: t.colors.border,
          // Logos are drawn for a light background, also in dark mode.
          backgroundColor: showImage ? '#fff' : t.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {showImage && logoUrl ? (
        <Image
          source={{ uri: badgeSrc(logoUrl) }}
          recyclingKey={logoUrl}
          cachePolicy="memory-disk"
          contentFit="contain"
          transition={120}
          style={{ width: px - 6, height: px - 6 }}
          onError={() => setFailed(logoUrl)}
          accessible={false}
        />
      ) : (
        <Text style={{ color: t.colors.textSecondary, fontWeight: '800', fontSize: Math.max(9, px * 0.34) }} numberOfLines={1}>
          {monogram(label)}
        </Text>
      )}
    </View>
  );
}

/** Brand logo + "Brand Model" text, e.g. in list rows and headers. */
export function VehicleName({
  brand,
  model,
  logoUrl,
  year,
  size = 'xs',
  tone = 'secondary',
}: {
  brand?: string | null;
  model?: string | null;
  logoUrl?: string | null;
  year?: number | string | null;
  size?: BrandLogoSize;
  tone?: 'default' | 'secondary';
}) {
  const t = useTheme();
  const text = [brand, model].filter(Boolean).join(' ') + (year ? ` · ${year}` : '');
  if (!text.trim()) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs, minWidth: 0, flexShrink: 1 }}>
      <BrandLogo name={brand} logoUrl={logoUrl} size={size} />
      <Txt variant="caption" tone={tone} numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
