import { router } from 'expo-router';
import { Building2, Clock, LogOut } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BrandMark } from '@/components/brand';
import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, EmptyState, Group, Header, ListRow, Screen, Txt } from '@/components/ui';
import { orgBlock, useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function SelectOrganizationScreen() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { me, selectOrganization, logout } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const orgs = me?.organizations ?? [];

  const choose = async (slug: string, name: string) => {
    setBusy(slug);
    try {
      await selectOrganization(slug);
    } catch (error) {
      const code = isApiError(error) ? error.code : '';
      toast.error(
        code === 'ORGANIZATION_ACCESS_EXPIRED' ? tr('organizations.access.expired_title') : tr('common.error_generic'),
        code === 'ORGANIZATION_ACCESS_EXPIRED' ? tr('organizations.access.expired_description', { name }) : undefined,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      header={<Header back={false} title={tr('mobile.org.pick_title')} subtitle={me ? `${me.user.name} ${me.user.surname}` : undefined} />}
      footer={
        <>
          <Button label={tr('common.logout')} variant="outline" icon={<LogOut size={18} color={t.colors.text} />} onPress={logout} />
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
                      ? tr('organizations.access.expired_title')
                      : org.access_ends_at
                        ? `${tr(`organizations.roles.${org.role}`)} · ${fmt.date(org.access_ends_at)}`
                        : tr(`organizations.roles.${org.role}`)
                  }
                  left={
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Building2 size={20} color={t.colors.primary} />
                    </View>
                  }
                  right={busy === org.slug ? <ActivityIndicator color={t.colors.primary} /> : block ? <Badge tone="danger" label={tr('organizations.access.expired_title')} icon={<Clock size={12} color={t.colors.danger} />} /> : undefined}
                  onPress={block || busy ? undefined : () => choose(org.slug, org.name)}
                  disabled={Boolean(block)}
                  last={i === orgs.length - 1}
                />
              );
            })}
          </Group>
        </View>
      )}
    </Screen>
  );
}
