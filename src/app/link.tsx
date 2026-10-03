/**
 * Resolves a web address (`?to=/t/{slug}/...`) from a universal link, a push tap or an inbox action.
 * Signed out → remember it and go to sign-in; another organization → switch first; then open the
 * matching app screen. `+native-intent` sends tenant links here.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Link2Off } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, EmptyState, Header, Screen } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { resolveWebPath } from '@/features/notifications/deep-links';
import { setPendingLink } from '@/features/notifications/pending-link';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('link');

type Failure = 'no_access' | 'switch_failed';

export default function LinkScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { to } = useLocalSearchParams<{ to?: string }>();
  const { status, me, organization, selectOrganization, orgBlock } = useAuth();
  const resolved = useMemo(() => resolveWebPath(to), [to]);
  const [switchFailed, setSwitchFailed] = useState(false);
  // The link's organization isn't one the user can open (not a member, expired, suspended).
  const noAccess = useMemo(() => {
    if (resolved?.kind !== 'tenant' || status === 'booting' || status === 'signedOut') return false;
    if (status === 'ready' && organization?.slug === resolved.slug) return false;
    const membership = me?.organizations?.find((o) => o.slug === resolved.slug);
    return !membership || Boolean(orgBlock(membership));
  }, [resolved, status, organization?.slug, me, orgBlock]);
  const failure: Failure | null = noAccess ? 'no_access' : switchFailed ? 'switch_failed' : null;
  const switching = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    if (status === 'booting' || done.current || failure) return;
    const go = (href: string) => {
      done.current = true;
      router.replace(href as Href);
    };

    if (!resolved) {
      log.warn('Unknown link', { to });
      go('/');
      return;
    }
    if (resolved.kind !== 'tenant') {
      go(resolved.href);
      return;
    }
    if (status === 'signedOut') {
      setPendingLink(to ?? null);
      go('/login');
      return;
    }
    if (status === 'ready' && organization?.slug === resolved.slug) {
      log.info('Opening link', { href: resolved.href });
      go(resolved.href);
      return;
    }
    if (switching.current) return;
    switching.current = true;
    log.info('Switching organization for link', { slug: resolved.slug });
    // Once the switch lands, `organization.slug` matches and the branch above navigates.
    selectOrganization(resolved.slug).catch((error) => {
      log.warn('Organization switch failed', error);
      setSwitchFailed(true);
    });
  }, [status, resolved, organization?.slug, selectOrganization, to, failure]);

  if (failure) {
    return (
      <Screen header={<Header title={tr('mobile.notifications.link.title')} onBack={() => router.replace('/')} />}>
        <EmptyState
          icon={<Link2Off size={28} color={t.colors.textMuted} />}
          title={tr(`mobile.notifications.link.${failure}_title`)}
          description={tr(`mobile.notifications.link.${failure}_body`)}
          action={<Button label={tr('mobile.notifications.link.home')} onPress={() => router.replace('/')} />}
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
      <ActivityIndicator color={t.colors.primary} accessibilityLabel={tr('mobile.notifications.link.opening')} />
    </View>
  );
}
