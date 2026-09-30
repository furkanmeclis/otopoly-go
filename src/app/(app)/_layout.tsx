import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/feedback/error-boundary';
import { WidgetSync } from '@/features/widgets/use-widget-sync';
import { useTheme } from '@/theme/provider';

export { RouteErrorBoundary as ErrorBoundary };

export default function AppLayout() {
  const theme = useTheme();
  return (
    <>
      <WidgetSync />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}
