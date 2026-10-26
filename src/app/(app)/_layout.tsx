import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/feedback/error-boundary';
import { LinkIntentHost } from '@/features/account/components/link-intent-host';
import { IntentsInvocationHost, IntentsSync } from '@/features/intents/intents-host';
import { TenantAccessGate } from '@/features/auth/components/tenant-access-gate';
import { LiveHost } from '@/features/live/live-host';
import { LimitReachedHost } from '@/features/billing/components/limit-reached-host';
import { NotificationsHost } from '@/features/notifications/components/notifications-host';
import { FirstRunHost } from '@/features/onboarding/components/first-run-host';
import { QaTour } from '@/features/qa/qa-tour';
import { WidgetSync } from '@/features/widgets/use-widget-sync';
import { useTheme } from '@/theme/provider';

export { RouteErrorBoundary as ErrorBoundary };

export default function AppLayout() {
  const theme = useTheme();
  return (
    <>
      <WidgetSync />
      <LiveHost />
      <LimitReachedHost />
      {/* Before NotificationsHost: resets the "first-run settled" signal the push sheet waits for. */}
      <FirstRunHost />
      <NotificationsHost />
      <LinkIntentHost />
      {/* Siri / Shortcuts: catalogs for Siri and queued invocations (iOS; no-op elsewhere). */}
      <IntentsSync />
      <IntentsInvocationHost />
      <QaTour />
      <TenantAccessGate>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </TenantAccessGate>
    </>
  );
}
