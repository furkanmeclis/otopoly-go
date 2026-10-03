import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider, useNavigationContainerRef, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandMark, MARK_RATIO } from '@/components/brand';
import { devToolsEnabled } from '@/config/env';
import { RouteErrorBoundary } from '@/components/feedback/error-boundary';
import { ToastProvider } from '@/components/feedback/toast';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { NotificationResponseObserver } from '@/features/notifications/components/notification-response-observer';
import { LocaleProvider } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { installGlobalErrorHandlers } from '@/lib/logger/global-handlers';
import { initSentry, navigationIntegration, Sentry, sentryEnabled } from '@/lib/monitoring/sentry';
import { createQueryClient } from '@/lib/query';
import { useAppStateQueryFocus } from '@/lib/query-focus';
import { ThemeProvider, useTheme } from '@/theme/provider';

// No EXPO_PUBLIC_SENTRY_DSN → no-op (see docs/SENTRY.md).
initSentry();
installGlobalErrorHandlers();

// Keep the native splash (brand mark) up until the stored session has been restored.
SplashScreen.preventAutoHideAsync().catch(() => {});

export { RouteErrorBoundary as ErrorBoundary };

const navLog = createLogger('nav');

/** Hands the navigation container to Sentry so performance traces carry screen (route) names. */
function SentryNavigationRegistrar() {
  const ref = useNavigationContainerRef();
  useEffect(() => {
    if (ref) navigationIntegration.registerNavigationContainer(ref);
  }, [ref]);
  return null;
}

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
      {sentryEnabled ? <SentryNavigationRegistrar /> : null}
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
        {/* Account deletion: from the profile, and from the org picker for users without a business. */}
        <Stack.Protected guard={status === 'ready' || status === 'selectOrg'}>
          <Stack.Screen name="delete-account" />
        </Stack.Protected>
        {/* Logs and demo scenarios: never reachable in App Store / Play Store builds. */}
        <Stack.Protected guard={devToolsEnabled}>
          <Stack.Screen name="diagnostics" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </NavThemeProvider>
  );
}

function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useAppStateQueryFocus();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <LocaleProvider>
            {/* Catches (and reports) crashes outside a route, e.g. in the query / auth providers. */}
            <Sentry.ErrorBoundary
              fallback={({ error, resetError }) => (
                <RouteErrorBoundary error={error instanceof Error ? error : new Error(String(error))} retry={async () => resetError()} reported />
              )}>
              <QueryClientProvider client={queryClient}>
                <ToastProvider>
                  <AuthProvider>
                    <RootNavigator />
                  </AuthProvider>
                </ToastProvider>
              </QueryClientProvider>
            </Sentry.ErrorBoundary>
          </LocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default sentryEnabled ? Sentry.wrap(RootLayout) : RootLayout;
