import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/feedback/error-boundary';
import { LinkIntentHost } from '@/features/account/components/link-intent-host';
import { TenantAccessGate } from '@/features/auth/components/tenant-access-gate';
import { LimitReachedHost } from '@/features/billing/components/limit-reached-host';
import { NotificationsHost } from '@/features/notifications/components/notifications-host';
import { QaTour } from '@/features/qa/qa-tour';
import { WidgetSync } from '@/features/widgets/use-widget-sync';
import { useTheme } from '@/theme/provider';

export { RouteErrorBoundary as ErrorBoundary };

export default function AppLayout() {
  const theme = useTheme();
  return (
    <>
      <WidgetSync />
      <LimitReachedHost />
      <NotificationsHost />
      <LinkIntentHost />
      <QaTour />
      <TenantAccessGate>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </TenantAccessGate>
    </>
  );
}
