import { Stack } from 'expo-router';

import { useAuth } from '@/features/auth/auth-provider';

export const unstable_settings = {
  anchor: 'index',
};

export default function AuthLayout() {
  // Read during boot (auth provider), so a signed-out launch opens on the right first screen.
  const { introSeen } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* Intro carousel, once per device before the first sign-in. Links that open /login skip it. */}
      <Stack.Protected guard={!introSeen}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
