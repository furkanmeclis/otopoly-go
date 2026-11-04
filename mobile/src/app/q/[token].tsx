/**
 * `https://otopoly.app/q/{token}`: the customer-facing quote page. It is meant for the business's
 * customer, so when it opens the app (universal link) we explain that and offer to pass it on.
 */
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { Copy, FileText, Share2 } from 'lucide-react-native';
import { Share, View } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { Button, Card, Header, Screen, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { WEB_HOST } from '@/features/notifications/deep-links';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';

export default function PublicQuoteLinkScreen() {
  useMarkInteractive();
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const { status, can } = useAuth();
  const { token } = useLocalSearchParams<{ token: string }>();
  const url = `https://${WEB_HOST}/q/${encodeURIComponent(token ?? '')}`;
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen header={<Header title={tr('mobile.notifications.quote_link.title')} onBack={leave} />}>
      <Card style={{ gap: t.spacing.md, alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <FileText size={22} color={t.colors.primary} />
        </View>
        <Txt variant="heading">{tr('mobile.notifications.quote_link.heading')}</Txt>
        <Txt tone="secondary">{tr('mobile.notifications.quote_link.body')}</Txt>
        <Txt variant="caption" tone="muted" selectable numberOfLines={2}>
          {url}
        </Txt>
      </Card>
      <Button label={tr('mobile.notifications.quote_link.share')} icon={<Share2 size={18} color={t.colors.onPrimary} />} onPress={() => Share.share({ message: url, url })} />
      <Button
        label={tr('mobile.notifications.quote_link.copy')}
        variant="outline"
        icon={<Copy size={18} color={t.colors.text} />}
        onPress={async () => {
          await Clipboard.setStringAsync(url);
          toast.success(tr('mobile.notifications.quote_link.copied'));
        }}
      />
      {status === 'ready' && can(P.quotesRead) ? (
        <Button label={tr('mobile.notifications.quote_link.open_quotes')} variant="ghost" onPress={() => router.replace('/quotes')} />
      ) : null}
    </Screen>
  );
}
