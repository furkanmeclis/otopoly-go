import { Stack } from 'expo-router';

import { useAuth } from '@/features/auth/auth-provider';

// No `index` here: `/` belongs to the signed-in Home only. Two routes on `/` let a guarded redirect
// resolve to the other (guarded) one and replace forever (blank screens, no requests).
export const unstable_settings = {
  anchor: 'login',
};

export default function AuthLayout() {
  // Read during boot (auth provider), so a signed-out launch opens on the right first screen.
  const { introSeen } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Intro carousel, once per device before the first sign-in. Links that open /login skip it. */}
      <Stack.Protected guard={!introSeen} redirectTo="/login">
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
