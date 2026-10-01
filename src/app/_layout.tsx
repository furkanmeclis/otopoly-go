import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandMark, MARK_RATIO } from '@/components/brand';
import { RouteErrorBoundary } from '@/components/feedback/error-boundary';
import { ToastProvider } from '@/components/feedback/toast';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { NotificationResponseObserver } from '@/features/notifications/components/notification-response-observer';
import { LocaleProvider } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { installGlobalErrorHandlers } from '@/lib/logger/global-handlers';
import { createQueryClient } from '@/lib/query';
import { ThemeProvider, useTheme } from '@/theme/provider';

installGlobalErrorHandlers();

// Keep the native splash (brand mark) up until the stored session has been restored.
SplashScreen.preventAutoHideAsync().catch(() => {});

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

  useEffect(() => {
    if (status !== 'booting') {
      SplashScreen.hide();
      return;
    }
    // Never trap the user behind the splash if restoring hangs; the boot view takes over.
    const timer = setTimeout(() => SplashScreen.hide(), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'booting') {
    // Same layout as the native splash, so the hand-off is seamless if restoring takes a moment.
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <BrandMark height={180 / MARK_RATIO} />
        <ActivityIndicator color={theme.colors.primary} style={{ position: 'absolute', bottom: '22%' }} />
      </View>
    );
  }

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationLogger />
      <NotificationResponseObserver />
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
