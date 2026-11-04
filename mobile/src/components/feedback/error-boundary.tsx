import type { ErrorBoundaryProps } from 'expo-router';
import { AlertOctagon } from 'lucide-react-native';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { captureError } from '@/lib/monitoring';
import { useTheme } from '@/theme/provider';

const log = createLogger('boundary');

/**
 * Route-level error boundary (exported as `ErrorBoundary` from layouts).
 * Logs and reports the crash and offers a retry instead of a white screen.
 */
export function RouteErrorBoundary({ error, retry, reported }: ErrorBoundaryProps & { reported?: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  useEffect(() => {
    log.error('Route crashed', { message: error.message, stack: error.stack });
    // The root Sentry.ErrorBoundary already reported what it renders this fallback for.
    if (!reported) captureError(error, { tags: { boundary: 'route' } });
  }, [error, reported]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: t.spacing.xxl, gap: t.spacing.lg }}>
        <View style={{ alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.colors.dangerBg, alignItems: 'center', justifyContent: 'center' }}>
            <AlertOctagon size={32} color={t.colors.danger} />
          </View>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            {tr('mobile.error.boundary_title')}
          </Txt>
          <Txt tone="secondary" style={{ textAlign: 'center' }}>
            {tr('mobile.error.boundary_description')}
          </Txt>
        </View>
        {__DEV__ ? (
          <View style={{ backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.md, padding: t.spacing.md }}>
            <Txt variant="caption" tone="danger" selectable>
              {error.message}
            </Txt>
          </View>
        ) : null}
        <Button label={tr('mobile.error.try_again')} onPress={retry} />
      </ScrollView>
    </SafeAreaView>
  );
}
