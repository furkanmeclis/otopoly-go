import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { Building2, Clock, LogOut, Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BrandMark } from '@/components/brand';
import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, EmptyState, Group, Header, ListRow, Screen, Sheet, Txt } from '@/components/ui';
import type { OrganizationMembership } from '@/features/account/services/auth.service';
import { TenantAccessState } from '@/features/auth/components/tenant-access-state';
import { orgBlock, useAuth } from '@/features/auth/auth-provider';
import { onboardingService, registrationOpen } from '@/features/onboarding/services/onboarding.service';
import { takeCreateBusinessForward } from '@/features/onboarding/state';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';

export default function SelectOrganizationScreen() {
  useMarkInteractive();
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { me, selectOrganization, logout } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // A blocked organization opens its access state (expired / suspended) instead of doing nothing.
  const [blocked, setBlocked] = useState<OrganizationMembership | null>(null);
  const blockedState = blocked ? orgBlock(blocked) : null;
  const orgs = me?.organizations ?? [];
  const none = orgs.length === 0;
  // Hide "Create business" only when the server says self-registration is off (unknown → show; the API decides).
  const config = useQuery({ queryKey: ['app', 'config'], queryFn: () => onboardingService.appConfig(), enabled: none, staleTime: 5 * 60 * 1000 });
  const canCreate = registrationOpen(config.data);
  const email = me?.user.email ?? '';

  // New accounts (sign-up, first Apple / Google sign-in) have no business yet: open the setup wizard,
  // once per sign-in. On focus, so the push lands after the navigator switch into this screen; coming
  // back from the wizard focuses this screen again but does not forward a second time (no bounce).
  const forwardReady = none && config.isSuccess && canCreate;
  useFocusEffect(
    useCallback(() => {
      if (forwardReady && takeCreateBusinessForward()) router.push('/create-business');
    }, [forwardReady]),
  );

  const choose = async (slug: string, name: string) => {
    setBusy(slug);
    try {
      await selectOrganization(slug);
    } catch (error) {
      const code = isApiError(error) ? error.code : '';
      const org = orgs.find((o) => o.slug === slug);
      if (code === 'ORGANIZATION_ACCESS_EXPIRED' && org) setBlocked({ ...org, status: org.status === 'suspended' ? org.status : 'expired' });
      else toast.error(code === 'NO_TENANT_MEMBERSHIP' ? tr('organizations.access.denied_title') : tr('common.error_generic'), code === 'NO_TENANT_MEMBERSHIP' ? tr('organizations.access.denied_description') : name);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      header={<Header back={false} title={tr(none ? 'mobile.onboarding.org.welcome_title' : 'mobile.org.pick_title')} subtitle={me ? `${me.user.name} ${me.user.surname}`.trim() : undefined} />}
      footer={
        <>
          <Button label={tr('common.logout')} variant="outline" icon={<LogOut size={18} color={t.colors.text} />} onPress={() => void logout()} />
          <Button label={tr('mobile.auth.delete.row_title')} variant="ghost" size="sm" onPress={() => router.push('/delete-account')} />
        </>
      }
    >
      {none ? (
        <View style={{ gap: t.spacing.lg }}>
          <BrandMark height={36} />
          <EmptyState
            icon={<Building2 size={28} color={t.colors.primary} />}
            title={tr('mobile.onboarding.org.none_title')}
            description={tr(canCreate ? 'mobile.onboarding.org.none_description' : 'mobile.org.none_description')}
            action={
              config.isLoading ? (
                <ActivityIndicator color={t.colors.primary} />
              ) : canCreate ? (
                <Button
                  label={tr('mobile.onboarding.org.create')}
                  icon={<Plus size={18} color={t.colors.onPrimary} />}
                  onPress={() => router.push('/create-business')}
                />
              ) : undefined
            }
          />
          <Txt tone="secondary" variant="caption" style={{ textAlign: 'center' }}>
            {canCreate ? tr('mobile.onboarding.org.invited', { email }) : tr('mobile.onboarding.org.invited_closed', { email })}
          </Txt>
        </View>
      ) : (
        <View style={{ gap: t.spacing.md }}>
          <BrandMark height={36} />
          <Txt tone="secondary">{tr('mobile.org.pick_description')}</Txt>
          <Group>
            {orgs.map((org, i) => {
              const block = orgBlock(org);
              return (
                <ListRow
                  key={org.uuid}
                  title={org.name}
                  subtitle={
                    block
                      ? tr(block === 'suspended' ? 'mobile.access.suspended_title' : 'organizations.access.expired_title')
                      : org.access_ends_at
                        ? `${tr(`organizations.roles.${org.role}`)} · ${fmt.date(org.access_ends_at)}`
                        : tr(`organizations.roles.${org.role}`)
                  }
                  left={
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Building2 size={20} color={t.colors.primary} />
                    </View>
                  }
                  right={busy === org.slug ? <ActivityIndicator color={t.colors.primary} /> : block ? <Badge tone="neutral" label={tr(block === 'suspended' ? 'mobile.access.suspended_badge' : 'mobile.access.expired_badge')} icon={<Clock size={12} color={t.colors.textMuted} />} /> : undefined}
                  onPress={busy ? undefined : block ? () => setBlocked(org) : () => choose(org.slug, org.name)}
                  last={i === orgs.length - 1}
                />
              );
            })}
          </Group>
        </View>
      )}
      <Sheet visible={Boolean(blockedState)} onClose={() => setBlocked(null)} title={blocked?.name ?? ''}>
        {blocked && blockedState ? (
          <TenantAccessState
            state={blockedState}
            orgName={blocked.name}
            isOwner={blocked.role === 'owner'}
            actions={<Button label={tr('common.close')} variant="outline" onPress={() => setBlocked(null)} />}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
