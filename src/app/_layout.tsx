import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RouteErrorBoundary } from '@/components/feedback/error-boundary';
import { ToastProvider } from '@/components/feedback/toast';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { LocaleProvider } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { installGlobalErrorHandlers } from '@/lib/logger/global-handlers';
import { createQueryClient } from '@/lib/query';
import { ThemeProvider, useTheme } from '@/theme/provider';

installGlobalErrorHandlers();

export { RouteErrorBoundary as ErrorBoundary };

const navLog = createLogger('nav');

function NavigationLogger() {
  const pathname = usePathname();
  useEffect(() => {
    navLog.info('Screen', { pathname });
  }, [pathname]);
  return null;
}

function RootNavigator() {
  const { status } = useAuth();
  const theme = useTheme();
  const navTheme = useMemo(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.danger,
      },
    };
  }, [theme]);

  if (status === 'booting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationLogger />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'selectOrg'}>
          <Stack.Screen name="select-org" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'ready'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Screen name="diagnostics" options={{ presentation: 'modal' }} />
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <LocaleProvider>
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <AuthProvider>
                  <RootNavigator />
                </AuthProvider>
              </ToastProvider>
            </QueryClientProvider>
          </LocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
