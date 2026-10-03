import { router } from 'expo-router';
import { Building2, Clock, LogOut } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BrandMark } from '@/components/brand';
import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, EmptyState, Group, Header, ListRow, Screen, Sheet, Txt } from '@/components/ui';
import type { OrganizationMembership } from '@/features/account/services/auth.service';
import { TenantAccessState } from '@/features/auth/components/tenant-access-state';
import { orgBlock, useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function SelectOrganizationScreen() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { me, selectOrganization, logout } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // A blocked organization opens its access state (expired / suspended) instead of doing nothing.
  const [blocked, setBlocked] = useState<OrganizationMembership | null>(null);
  const blockedState = blocked ? orgBlock(blocked) : null;
  const orgs = me?.organizations ?? [];

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
      header={<Header back={false} title={tr('mobile.org.pick_title')} subtitle={me ? `${me.user.name} ${me.user.surname}` : undefined} />}
      footer={
        <>
          <Button label={tr('common.logout')} variant="outline" icon={<LogOut size={18} color={t.colors.text} />} onPress={() => void logout()} />
          <Button label={tr('mobile.auth.delete.row_title')} variant="ghost" size="sm" onPress={() => router.push('/delete-account')} />
        </>
      }
    >
      {orgs.length === 0 ? (
        <EmptyState icon={<Building2 size={28} color={t.colors.textMuted} />} title={tr('mobile.org.none_title')} description={tr('mobile.org.none_description')} />
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
