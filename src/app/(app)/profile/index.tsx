import { router } from 'expo-router';
import { Bell, Fingerprint, KeyRound, Link2, ScanQrCode, ShieldCheck, UserX } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Avatar, Badge, Button, Card, Group, Header, InfoRow, ListRow, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { useToast } from '@/components/feedback/toast';
import { SessionList } from '@/features/account/components/session-list';
import { accountKeys, useTotpStatus } from '@/features/account/queries';
import { authService } from '@/features/account/services/auth.service';
import { useAuth } from '@/features/auth/auth-provider';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { hasTranslation } from '@/lib/i18n/translate';
import { createLogger } from '@/lib/logger';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.profile');

/** Web `AccountProfilePage` (tenant shell). Password and preferences have their own mobile screens. */
/** Membership role codes → the labels the org switcher uses. */
const ROLE_LABEL: Record<string, string> = {
  organization_owner: 'organizations.roles.owner',
  organization_user: 'organizations.roles.staff',
};

export default function ProfileScreen() {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const { me, organization, refreshMe } = useAuth();
  const toast = useToast();
  const totp = useTotpStatus();
  const [refreshing, setRefreshing] = useState(false);
  const user = me?.user;
  const fullName = user ? `${user.name} ${user.surname}` : '';

  const verify = useApiMutation({
    key: 'account.email.verify_request',
    fn: () => authService.requestEmailVerify(user?.email),
    success: tr('auth.verify.request_success'),
    toastValidation: true,
    onSuccess: () => void refreshMe(),
  });

  const permissions = useMemo(() => [...(me?.permissions ?? [])].filter(Boolean).sort((a, b) => a.localeCompare(b)), [me?.permissions]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshMe(), totp.refetch()]);
    } catch (error) {
      log.warn('Profile refresh failed', error);
      toast.error(tr('common.error_generic'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen header={<Header title={tr('auth.profile.title')} subtitle={tr('auth.profile.description')} />} refreshing={refreshing} onRefresh={onRefresh}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Avatar name={fullName} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading" numberOfLines={1}>
            {fullName || '—'}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {user?.email ?? '—'}
          </Txt>
          {organization ? (
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              {`${organization.name} · ${tr(`organizations.roles.${organization.role}`)}`}
            </Txt>
          ) : null}
        </View>
      </Card>

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('auth.profile.name')} value={fullName || '—'} />
        <InfoRow label={tr('auth.profile.email')} value={user?.email ?? '—'} />
        <InfoRow label={tr('auth.profile.email_verified')}>
          {user?.email_verified ? (
            <Badge size="sm" tone="success" label={tr('auth.profile.verified')} />
          ) : (
            <Row gap={6}>
              <Badge size="sm" tone="warning" label={tr('auth.profile.unverified')} />
              <Button size="sm" variant="outline" label={tr('auth.verify.request')} loading={verify.isPending} onPress={() => verify.mutate(undefined)} />
            </Row>
          )}
        </InfoRow>
        <InfoRow label={tr('auth.profile.status')}>{user?.status ? <Badge size="sm" tone={user.status === 'active' ? 'success' : 'neutral'} label={['active', 'disabled', 'pending'].includes(user.status) ? tr(`users.status.${user.status}`) : user.status} /> : <Txt>—</Txt>}</InfoRow>
        <InfoRow label={tr('auth.profile.locale')} value={tr(`mobile.language.${locale}`)} />
        <InfoRow label={tr('auth.profile.roles_title')}>
          {me?.roles.length ? (
            <Row gap={4} wrap style={{ justifyContent: 'flex-end', flexShrink: 1 }}>
              {me.roles.map((r) => (
                <Badge key={r} size="sm" label={ROLE_LABEL[r] ? tr(ROLE_LABEL[r]) : r} />
              ))}
            </Row>
          ) : (
            <Txt>—</Txt>
          )}
        </InfoRow>
        <InfoRow label={tr('auth.profile.uuid')} last>
          <Txt variant="caption" selectable style={{ fontFamily: 'Menlo', flexShrink: 1 }} numberOfLines={1}>
            {user?.uuid ?? '—'}
          </Txt>
        </InfoRow>
      </Card>

      {user ? <ProfileEditCard key={`${user.name}|${user.surname}`} name={user.name} surname={user.surname} /> : null}

      <Section title={tr('mobile.catalog.profile_security')}>
        <Group>
          <ListRow title={tr('auth.password.title')} subtitle={tr('auth.profile.change_password_body')} left={<KeyRound size={20} color={t.colors.primary} />} onPress={() => router.push('/profile/password')} />
          <ListRow title={tr('auth.oauth.title')} subtitle={tr('auth.oauth.profile_hint')} left={<Link2 size={20} color={t.colors.primary} />} onPress={() => router.push('/profile/linked-accounts')} />
          <ListRow title={tr('mobile.qr.menu_title')} subtitle={tr('mobile.qr.menu_subtitle')} left={<ScanQrCode size={20} color={t.colors.primary} />} onPress={() => router.push('/qr-scan')} />
          <ListRow title={tr('auth.preferences.title')} subtitle={tr('auth.preferences.description')} left={<Bell size={20} color={t.colors.primary} />} onPress={() => router.push('/profile/preferences')} />
          <ListRow
            title={tr('auth.totp.title')}
            subtitle={tr('mobile.common.not_available_mobile')}
            left={<ShieldCheck size={20} color={t.colors.textSecondary} />}
            right={totp.data ? <Badge size="sm" tone={totp.data.enabled ? 'success' : 'neutral'} label={totp.data.enabled ? tr('auth.totp.status_on') : tr('auth.totp.status_off')} /> : undefined}
            chevron={false}
          />
          <ListRow title={tr('auth.passkey.title')} subtitle={tr('mobile.common.not_available_mobile')} left={<Fingerprint size={20} color={t.colors.textSecondary} />} chevron={false} />
          <ListRow
            title={tr('mobile.auth.delete.row_title')}
            subtitle={tr('mobile.auth.delete.row_subtitle')}
            left={<UserX size={20} color={t.colors.danger} />}
            onPress={() => router.push('/delete-account')}
            last
          />
        </Group>
      </Section>

      <Section title={tr('auth.sessions.title')}>
        <Txt variant="caption" tone="secondary">
          {tr('auth.sessions.description')}
        </Txt>
        <SessionList />
      </Section>

      <Section title={tr('auth.profile.permissions_title')}>
        <Txt variant="caption" tone="secondary">
          {tr('auth.profile.permissions_hint')}
        </Txt>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          {permissions.length === 0 ? (
            <Txt tone="secondary" style={{ paddingVertical: t.spacing.lg }}>
              {tr('permissions.view_empty')}
            </Txt>
          ) : (
            permissions.map((slug, i) => {
              const key = `permissions.labels.${slug}`;
              return (
                <View key={slug} style={{ paddingVertical: t.spacing.sm, borderBottomWidth: i === permissions.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
                  <Txt>{hasTranslation(locale, key) ? tr(key) : slug}</Txt>
                  <Txt variant="caption" tone="muted" style={{ fontFamily: 'Menlo', fontSize: 11 }}>
                    {slug}
                  </Txt>
                </View>
              );
            })
          )}
        </Card>
      </Section>
    </Screen>
  );
}

/** Web `ProfileEditForm`: name + surname via PATCH /v1/auth/profile. */
function ProfileEditCard({ name: initialName, surname: initialSurname }: { name: string; surname: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { refreshMe } = useAuth();
  const [name, setName] = useState(initialName);
  const [surname, setSurname] = useState(initialSurname);
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useApiMutation({
    key: 'account.profile.update',
    fn: () => authService.updateProfile({ name: name.trim(), surname: surname.trim() }),
    invalidate: [qk.staff, accountKeys.sessions],
    success: tr('auth.profile.save_success'),
    onSuccess: () => void refreshMe(),
  });
  const errs = { ...fieldErrors(save.error), ...local };
  const dirty = name.trim() !== initialName || surname.trim() !== initialSurname;
  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = tr('auth.validation.name_required');
    if (!surname.trim()) e.surname = tr('auth.validation.surname_required');
    setLocal(e);
    if (!Object.keys(e).length) save.mutate(undefined);
  };
  return (
    <Section title={tr('auth.profile.edit_title')}>
      <Card style={{ gap: t.spacing.md }}>
        <Txt variant="caption" tone="secondary">
          {tr('auth.profile.edit_hint')}
        </Txt>
        <TextField label={tr('auth.profile.first_name')} value={name} onChangeText={setName} autoComplete="given-name" error={errs.name} />
        <TextField label={tr('auth.profile.last_name')} value={surname} onChangeText={setSurname} autoComplete="family-name" error={errs.surname} />
        <Button label={save.isPending ? tr('auth.profile.saving') : tr('auth.profile.save')} loading={save.isPending} disabled={!dirty} onPress={submit} />
      </Card>
    </Section>
  );
}
