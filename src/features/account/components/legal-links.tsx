/**
 * Privacy policy and terms links (App Store 5.1.1(i), Google Play User Data policy): reachable from
 * the sign-in screen, the profile, the AI consent screen and the account deletion screen. URLs come
 * from `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` (defaults: otopoly.app/privacy, /terms).
 */
import { FileText, ShieldCheck } from 'lucide-react-native';
import { useCallback } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { Group, ListRow, Txt } from '@/components/ui';
import { env } from '@/config/env';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('legal');

export type LegalDoc = 'privacy' | 'terms';

export const legalUrl = (doc: LegalDoc) => (doc === 'privacy' ? env.privacyUrl : env.termsUrl);

export function useOpenLegal() {
  const { t: tr } = useLocale();
  const toast = useToast();
  return useCallback(
    async (doc: LegalDoc) => {
      const url = legalUrl(doc);
      try {
        await Linking.openURL(url);
      } catch (error) {
        log.warn('Opening legal page failed', { doc, error });
        toast.error(tr('mobile.account.legal.open_failed', { url }));
      }
    },
    [toast, tr],
  );
}

/** Compact inline links, e.g. under the sign-in form: "Gizlilik Politikası · Kullanım Koşulları". */
export function LegalLinks({ notice, docs = ['privacy', 'terms'] }: { notice?: string; docs?: LegalDoc[] }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const open = useOpenLegal();
  return (
    <View style={{ alignItems: 'center', gap: t.spacing.xs }}>
      {notice ? (
        <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {notice}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {docs.map((doc, i) => (
          <View key={doc} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {i > 0 ? (
              <Txt variant="caption" tone="muted">
                {' · '}
              </Txt>
            ) : null}
            <Pressable onPress={() => void open(doc)} accessibilityRole="link" hitSlop={8} style={{ paddingVertical: t.spacing.xs }}>
              <Txt variant="caption" tone="primary" style={{ textDecorationLine: 'underline' }}>
                {tr(doc === 'privacy' ? 'mobile.account.legal.privacy' : 'mobile.account.legal.terms')}
              </Txt>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Profile → "Yasal" group. */
export function LegalGroup() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const open = useOpenLegal();
  return (
    <Group>
      <ListRow
        title={tr('mobile.account.legal.privacy')}
        subtitle={tr('mobile.account.legal.privacy_subtitle')}
        left={<ShieldCheck size={20} color={t.colors.primary} />}
        onPress={() => void open('privacy')}
        accessibilityLabel={tr('mobile.account.legal.privacy')}
      />
      <ListRow title={tr('mobile.account.legal.terms')} left={<FileText size={20} color={t.colors.primary} />} onPress={() => void open('terms')} last />
    </Group>
  );
}
