/**
 * Design tokens. Screens never use raw colors — they read `theme.colors.*` from `useTheme()`.
 * Brand: Otopoly orange (#EA6E43) on warm neutrals.
 */

export type ColorTokens = {
  // Brand
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;

  // Surfaces
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceSunken: string;
  overlay: string;

  // Lines
  border: string;
  borderStrong: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Semantic (fg = icon/text, bg = soft background)
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;
  neutral: string;
  neutralBg: string;

  // Charts (categorical, validated for both modes)
  chart: [string, string, string, string, string, string];

  skeleton: string;
  shadow: string;
  tabBar: string;
};

export const lightColors: ColorTokens = {
  primary: '#EA6E43',
  primaryPressed: '#D45B31',
  primarySoft: '#FDE7DC',
  onPrimary: '#FFFFFF',

  background: '#FBF7F4',
  surface: '#FFFFFF',
  surfaceAlt: '#F6EFEA',
  surfaceSunken: '#F3EBE6',
  overlay: 'rgba(26, 20, 18, 0.45)',

  border: '#EAE1DB',
  borderStrong: '#D4C8C0',

  text: '#1A1412',
  textSecondary: '#6B5E57',
  textMuted: '#9C8880',
  textInverse: '#FFFFFF',

  success: '#15803D',
  successBg: '#DCFCE7',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  danger: '#DC2626',
  dangerBg: '#FEE2E2',
  info: '#2563EB',
  infoBg: '#DBEAFE',
  neutral: '#6B5E57',
  neutralBg: '#F3EBE6',

  chart: ['#EA6E43', '#2563EB', '#16A34A', '#9333EA', '#D97706', '#0891B2'],

  skeleton: '#EFE6E0',
  shadow: '#1A1412',
  tabBar: '#FFFFFF',
};

export const darkColors: ColorTokens = {
  primary: '#F07D55',
  primaryPressed: '#F59A78',
  primarySoft: '#3A241B',
  onPrimary: '#1A0F0A',

  background: '#120E0C',
  surface: '#1C1714',
  surfaceAlt: '#241D19',
  surfaceSunken: '#0D0A09',
  overlay: 'rgba(0, 0, 0, 0.6)',

  border: '#302723',
  borderStrong: '#463A33',

  text: '#F7F1ED',
  textSecondary: '#C4B3AA',
  textMuted: '#8E7C73',
  textInverse: '#1A1412',

  success: '#4ADE80',
  successBg: '#12291A',
  warning: '#FBBF24',
  warningBg: '#2E2310',
  danger: '#F87171',
  dangerBg: '#321717',
  info: '#60A5FA',
  infoBg: '#142238',
  neutral: '#C4B3AA',
  neutralBg: '#2A221E',

  chart: ['#F07D55', '#60A5FA', '#4ADE80', '#C084FC', '#FBBF24', '#22D3EE'],

  skeleton: '#2A221E',
  shadow: '#000000',
  tabBar: '#1C1714',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 } as const;
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, xxxl: 30, display: 36 } as const;
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

/** Minimum touch target (Apple HIG 44pt). */
export const HIT = 44;

export type Theme = {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  shadow: {
    sm: object;
    md: object;
  };
};

function shadows(colors: ColorTokens, dark: boolean) {
  return {
    sm: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: dark ? 0 : 0.05,
      shadowRadius: 3,
      elevation: dark ? 0 : 1,
    },
    md: {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: dark ? 0.4 : 0.1,
      shadowRadius: 16,
      elevation: 6,
    },
  };
}

export const lightTheme: Theme = {
  scheme: 'light',
  colors: lightColors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  shadow: shadows(lightColors, false),
};

export const darkTheme: Theme = {
  scheme: 'dark',
  colors: darkColors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  shadow: shadows(darkColors, true),
};
