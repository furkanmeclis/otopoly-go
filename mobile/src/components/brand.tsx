import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/provider';

import { Txt } from './ui';

/** The "OP" mark. The dark block is reversed on dark backgrounds so it keeps its contrast. */
const MARK = require('../../assets/brand/mark.png');
const MARK_DARK = require('../../assets/brand/mark-dark.png');
const APP_ICON = require('../../assets/brand/app-icon.png');

/** Width / height of the cropped mark artwork. */
export const MARK_RATIO = 779 / 453;

export function BrandMark({ height = 32, style }: { height?: number; style?: StyleProp<ImageStyle> }) {
  const t = useTheme();
  return (
    <Image
      source={t.scheme === 'dark' ? MARK_DARK : MARK}
      style={[{ height, width: height * MARK_RATIO }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="Otopoly"
    />
  );
}

/** The home-screen icon as a rounded tile (iOS squircle radius). */
export function AppIconTile({ size = 72, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.2237,
          overflow: 'hidden',
          borderWidth: t.scheme === 'dark' ? 0 : 1,
          borderColor: t.colors.border,
          backgroundColor: '#FFFFFF',
        },
        style,
      ]}
    >
      <Image source={APP_ICON} style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel="Otopoly" />
    </View>
  );
}

/** Mark + "Otopoly" word, used for small branded footers and headers. */
export function BrandLockup({ height = 20, caption }: { height?: number; caption?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
      <BrandMark height={height} />
      <View>
        <Txt variant="bodyStrong" style={{ fontSize: height * 0.8, lineHeight: height }}>
          Otopoly
        </Txt>
        {caption ? (
          <Txt variant="caption" tone="muted">
            {caption}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
