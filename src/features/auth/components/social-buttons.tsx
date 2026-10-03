import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Txt } from '@/components/ui';
import { isMock } from '@/config/env';
import { appleModule, isAppleAvailable, isGoogleAvailable } from '@/features/auth/native/social';
import type { OAuthProvider } from '@/features/auth/services/passwordless.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const BUTTON_HEIGHT = 50;

/**
 * Which providers to offer. Live: Apple needs the native capability (iOS), Google needs its client
 * ids and module. App Store Guideline 4.8: on iOS Google is only offered together with Apple.
 * Demo (mock) builds offer both everywhere and use sample identities.
 */
export function useSocialProviders() {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    let alive = true;
    isAppleAvailable().then((ok) => alive && setApple(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (isMock) return { apple: true, google: true, nativeApple: apple };
  const google = isGoogleAvailable() && (Platform.OS !== 'ios' || apple);
  return { apple, google, nativeApple: apple };
}

export function SocialButtons({ onPress, busy, disabled }: { onPress: (provider: OAuthProvider) => void; busy: OAuthProvider | null; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const providers = useSocialProviders();
  if (!providers.apple && !providers.google) return null;
  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: t.colors.border }} />
        <Txt variant="caption" tone="muted">
          {tr('mobile.auth.or')}
        </Txt>
        <View style={{ flex: 1, height: 1, backgroundColor: t.colors.border }} />
      </View>
      {providers.apple ? <AppleButton native={providers.nativeApple} onPress={() => onPress('apple')} busy={busy === 'apple'} disabled={disabled} /> : null}
      {providers.google ? <GoogleButton onPress={() => onPress('google')} busy={busy === 'google'} disabled={disabled} /> : null}
    </View>
  );
}

/**
 * The system "Sign in with Apple" button (ASAuthorizationAppleIDButton): Apple-approved title, logo,
 * colors and localization. Black on light, white on dark (HIG). Without the native capability
 * (demo builds on Android / older binaries) a demo stand-in is drawn instead.
 */
function AppleButton({ native, onPress, busy, disabled }: { native: boolean; onPress: () => void; busy: boolean; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const mod = native ? appleModule() : null;
  const dark = t.scheme === 'dark';
  if (mod) {
    const Button = mod.AppleAuthenticationButton;
    return (
      <View pointerEvents={busy || disabled ? 'none' : 'auto'} style={{ opacity: busy || disabled ? 0.6 : 1 }}>
        <Button
          buttonType={mod.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={dark ? mod.AppleAuthenticationButtonStyle.WHITE : mod.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={t.radius.md}
          style={{ width: '100%', height: BUTTON_HEIGHT }}
          onPress={onPress}
        />
      </View>
    );
  }
  return (
    <ProviderButton
      label={tr('auth.apple.sign_in')}
      onPress={onPress}
      busy={busy}
      disabled={disabled}
      bg={dark ? '#FFFFFF' : '#000000'}
      fg={dark ? '#000000' : '#FFFFFF'}
      border={dark ? '#FFFFFF' : '#000000'}
      icon={<AppleLogo color={dark ? '#000000' : '#FFFFFF'} />}
    />
  );
}

/** Google-branded button (light / dark theme colors and the standard "G" mark). */
function GoogleButton({ onPress, busy, disabled }: { onPress: () => void; busy: boolean; disabled?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const dark = t.scheme === 'dark';
  return (
    <ProviderButton
      label={tr('auth.google.sign_in')}
      onPress={onPress}
      busy={busy}
      disabled={disabled}
      bg={dark ? '#131314' : '#FFFFFF'}
      fg={dark ? '#E3E3E3' : '#1F1F1F'}
      border={dark ? '#8E918F' : '#747775'}
      icon={<GoogleLogo />}
    />
  );
}

function ProviderButton({
  label,
  onPress,
  busy,
  disabled,
  bg,
  fg,
  border,
  icon,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
  bg: string;
  fg: string;
  border: string;
  icon: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy || disabled, busy }}
      style={({ pressed }) => ({
        height: BUTTON_HEIGHT,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: busy || disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon}
      <Text style={{ color: fg, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

export function AppleLogo({ color }: { color: string }) {
  return (
    <Svg width={16} height={19} viewBox="0 0 814 1000">
      <Path
        fill={color}
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
      />
    </Svg>
  );
}
