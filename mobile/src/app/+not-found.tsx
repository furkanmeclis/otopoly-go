import { router, usePathname } from 'expo-router';
import { Hammer } from 'lucide-react-native';
import { useEffect } from 'react';

import { Button, EmptyState, Header, Screen, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('nav');

export default function NotFoundScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const pathname = usePathname();
  useEffect(() => {
    log.warn('Unmatched route', { pathname });
  }, [pathname]);
  return (
    <Screen header={<Header title="" />}>
      <EmptyState
        icon={<Hammer size={28} color={t.colors.primary} />}
        title={tr('mobile.not_found.title')}
        description={tr('mobile.not_found.description')}
        action={<Button label={tr('mobile.not_found.home')} onPress={() => router.replace('/')} />}
      />
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {pathname}
      </Txt>
    </Screen>
  );
}
