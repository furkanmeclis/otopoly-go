/**
 * `https://otopoly.app/login/qr/{id}`: QR sign-in approval. Placeholder until the QR login package
 * lands (wave 2, separate branch); the universal link already routes here.
 */
import { router } from 'expo-router';
import { QrCode } from 'lucide-react-native';

import { Button, EmptyState, Header, Screen } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function QrLoginScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen header={<Header title={tr('mobile.notifications.qr.title')} onBack={leave} />}>
      <EmptyState
        icon={<QrCode size={28} color={t.colors.textMuted} />}
        title={tr('mobile.notifications.qr.soon_title')}
        description={tr('mobile.notifications.qr.soon_body')}
        action={<Button label={tr('mobile.notifications.link.home')} onPress={leave} />}
      />
    </Screen>
  );
}
