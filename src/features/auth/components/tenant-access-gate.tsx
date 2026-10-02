import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Building2, LogOut, RefreshCw } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { subscribeApiEvents } from '@/api/events';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui';
import { isMock } from '@/config/env';
import { orgBlock, useAuth } from '@/features/auth/auth-provider';
import { TenantAccessState, type TenantAccess } from '@/features/auth/components/tenant-access-state';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('auth.access');

/** Codes the tenant middleware answers with when the organization can't be used any more. */
const ACCESS_CODES = new Set(['NO_TENANT_MEMBERSHIP', 'ORGANIZATION_ACCESS_EXPIRED', 'FORBIDDEN']);
const REFRESH_EVERY_MS = 10_000;

/**
 * Same states as the web `TenantRouteGuard`, checked while the app is open: membership removed →
 * denied; `access_ends_at` passed / status expired → expired; status suspended → suspended.
 * A tenant request answering `NO_TENANT_MEMBERSHIP`, `ORGANIZATION_ACCESS_EXPIRED` or `FORBIDDEN`
 * (the backend's suspended answer) reloads `/v1/auth/me`, and the screen follows the membership.
 */
export function TenantAccessGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const { status, me, organization, refreshMe, switchOrganization, logout } = useAuth();
  const lastRefresh = useRef(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(
    () =>
      subscribeApiEvents((error) => {
        if (!ACCESS_CODES.has(error.code)) return;
        const at = Date.now();
        if (at - lastRefresh.current < REFRESH_EVERY_MS) return;
        lastRefresh.current = at;
        log.info('Tenant access answer, reloading membership', { code: error.code });
        refreshMe().catch((err) => log.warn('Membership reload failed', err));
      }),
    [refreshMe],
  );

  const access: TenantAccess | null = status !== 'ready' || !me ? null : !organization ? 'denied' : orgBlock(organization);

  useEffect(() => {
    if (!access) return;
    log.warn('Organization not usable', { access, slug: organization?.slug });
    // Nothing from the business may stay on screen or in memory.
    qc.clear();
  }, [access, organization?.slug, qc]);

  const others = (me?.organizations ?? []).filter((o) => o.slug !== organization?.slug && !orgBlock(o));
  const retry = async () => {
    setRefreshing(true);
    try {
      await refreshMe();
    } catch (error) {
      log.warn('Membership reload failed', error);
    } finally {
      setRefreshing(false);
    }
  };

  // The navigator stays mounted underneath (an Expo Router layout keeps its navigator); the state covers it.
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} importantForAccessibility={access ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={Boolean(access)} pointerEvents={access ? 'none' : 'auto'}>
        {children}
      </View>
      {access ? (
        <SafeAreaView style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.background }]}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: t.spacing.xl, alignItems: 'center' }}>
            <BrandMark height={40} />
            <TenantAccessState
              state={access}
              orgName={organization?.name}
              isOwner={organization?.role === 'owner'}
              actions={
                <>
                  {others.length ? <Button label={tr('mobile.access.switch')} icon={<Building2 size={18} color={t.colors.onPrimary} />} onPress={switchOrganization} /> : null}
                  <Button label={tr('mobile.access.retry')} variant="outline" icon={<RefreshCw size={18} color={t.colors.text} />} loading={refreshing} onPress={() => void retry()} />
                  <Button label={tr('common.logout')} variant="ghost" icon={<LogOut size={18} color={t.colors.primary} />} onPress={() => void logout()} />
                  {isMock ? <Button label={tr('mobile.access.diagnostics')} variant="ghost" size="sm" onPress={() => router.push('/diagnostics')} /> : null}
                </>
              }
            />
          </ScrollView>
        </SafeAreaView>
      ) : null}
    </View>
  );
}
