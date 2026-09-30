import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Divider, ErrorState, Header, Row, Screen, Section, Segmented, Skeleton, SwitchRow, TextField, Txt } from '@/components/ui';
import { accountKeys, useNotificationPreferences, useTenantNotificationPreferences } from '@/features/account/queries';
import { authService } from '@/features/account/services/auth.service';
import { notificationPreferencesService, type NotificationPreferences } from '@/features/account/services/notification-preferences.service';
import {
  tenantNotificationPreferencesService,
  type NotificationChannelPrefs,
  type NotificationTypePreferences,
} from '@/features/account/services/tenant-notification-preferences.service';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import type { AppLocale } from '@/lib/i18n/translate';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.profile.preferences');

/**
 * Web profile "Bildirim tercihleri" + "Bu işletmedeki bildirimlerim" cards, plus the language
 * switch (synced to the backend profile like the web locale switcher).
 */
export default function PreferencesScreen() {
  const { t: tr } = useLocale();
  const prefs = useNotificationPreferences();
  const tenant = useTenantNotificationPreferences();
  return (
    <Screen
      header={<Header title={tr('auth.preferences.title')} subtitle={tr('auth.preferences.description')} />}
      refreshing={prefs.isRefetching || tenant.isRefetching}
      onRefresh={() => {
        prefs.refetch();
        tenant.refetch();
      }}
    >
      <LanguageCard />

      <Section title={tr('auth.preferences.title')}>
        {prefs.isLoading ? <Skeleton height={220} radius={16} /> : prefs.isError || !prefs.data ? <ErrorState onRetry={() => prefs.refetch()} /> : <UserPrefsForm key={JSON.stringify(prefs.data)} data={prefs.data} />}
      </Section>

      <Section title={tr('messaging.prefs.title')}>
        <Txt variant="caption" tone="secondary">
          {tr('messaging.prefs.description')}
        </Txt>
        {tenant.isLoading ? (
          <Skeleton height={260} radius={16} />
        ) : tenant.isError || !tenant.data ? (
          <ErrorState description={tr('messaging.prefs.error')} onRetry={() => tenant.refetch()} />
        ) : (
          <TenantPrefsForm key={JSON.stringify(tenant.data)} data={tenant.data} />
        )}
      </Section>
    </Screen>
  );
}

function LanguageCard() {
  const t = useTheme();
  const { t: tr, locale, setLocale } = useLocale();
  const { refreshMe } = useAuth();
  const change = (next: AppLocale) => {
    setLocale(next);
    authService
      .updateProfile({ locale: next })
      .then(() => refreshMe())
      .catch((error) => log.warn('Profile locale sync failed', error));
  };
  return (
    <Card style={{ gap: t.spacing.sm }}>
      <Txt variant="bodyStrong">{tr('mobile.language.title')}</Txt>
      <Segmented<AppLocale>
        value={locale}
        onChange={change}
        options={[
          { value: 'tr', label: tr('mobile.language.tr') },
          { value: 'en', label: tr('mobile.language.en') },
        ]}
      />
    </Card>
  );
}

function UserPrefsForm({ data }: { data: NotificationPreferences }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const [v, setV] = useState<NotificationPreferences>(data);
  const set = (k: keyof NotificationPreferences) => (value: boolean) => setV((p) => ({ ...p, [k]: value }));
  const save = useApiMutation({
    key: 'account.notification_preferences.update',
    fn: () => notificationPreferencesService.update(v),
    success: tr('auth.preferences.save_success'),
    toastValidation: true,
    onSuccess: (next) => qc.setQueryData(accountKeys.prefs, next),
  });
  return (
    <Card style={{ gap: t.spacing.md }}>
      <SwitchRow label={tr('auth.preferences.email')} description={tr('auth.preferences.email_hint')} value={v.email_enabled} onValueChange={set('email_enabled')} />
      <SwitchRow label={tr('auth.preferences.inapp')} description={tr('auth.preferences.inapp_hint')} value={v.inapp_enabled} onValueChange={set('inapp_enabled')} />
      <SwitchRow label={tr('auth.preferences.realtime')} description={tr('auth.preferences.realtime_hint')} value={v.realtime_enabled} onValueChange={set('realtime_enabled')} />
      {/* Web push is a browser subscription; native push isn't wired yet, so the stored value is kept but not editable here. */}
      <SwitchRow label={tr('auth.preferences.push')} description={tr('mobile.catalog.push_mobile_hint')} value={v.push_enabled} onValueChange={set('push_enabled')} disabled />
      <Button label={save.isPending ? tr('auth.preferences.saving') : tr('auth.preferences.save')} loading={save.isPending} onPress={() => save.mutate(undefined)} />
    </Card>
  );
}

const CHANNELS = ['inapp', 'email', 'whatsapp', 'sms'] as const;
type Channel = (typeof CHANNELS)[number];
const typeKey = (type: string) => type.replaceAll('.', '_');

function TenantPrefsForm({ data }: { data: NotificationTypePreferences }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const [phone, setPhone] = useState(data.phone);
  const [prefs, setPrefs] = useState<Record<string, NotificationChannelPrefs>>(() => Object.fromEntries(data.types.map((x) => [x.type, x.prefs])));
  const hasPhone = phone.trim() !== '';
  const needsPhone = Object.values(prefs).some((p) => (p.whatsapp || p.sms) && !hasPhone);
  const toggle = (type: string, ch: Channel, value: boolean) => setPrefs((p) => ({ ...p, [type]: { ...p[type], [ch]: value } }));

  const save = useApiMutation({
    key: 'account.tenant_notification_preferences.update',
    fn: () => tenantNotificationPreferencesService.update({ phone: phone.trim(), types: data.types.map((x) => ({ type: x.type, prefs: prefs[x.type] })) }),
    success: tr('messaging.prefs.saved'),
    toastValidation: true,
    onSuccess: (next) => qc.setQueryData(accountKeys.tenantPrefs, next),
  });

  return (
    <Card style={{ gap: t.spacing.md }}>
      <TextField
        label={tr('messaging.prefs.phone')}
        placeholder={tr('messaging.prefs.phone_placeholder')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={32}
        hint={tr('messaging.prefs.phone_hint')}
      />
      {data.types.length === 0 ? (
        <Txt tone="secondary">{tr('messaging.prefs.empty')}</Txt>
      ) : (
        data.types.map((type, i) => (
          <View key={type.type} style={{ gap: t.spacing.sm }}>
            {i > 0 ? <Divider /> : null}
            <Txt variant="bodyStrong">{tr(`messaging.types.${typeKey(type.type)}`)}</Txt>
            <Row gap={t.spacing.sm} wrap>
              {CHANNELS.filter((ch) => (type.channels as string[]).includes(ch)).map((ch) => (
                <View key={ch} style={{ width: '47%' }}>
                  <SwitchRow
                    label={tr(`messaging.channel.${ch}`)}
                    value={prefs[type.type]?.[ch] ?? false}
                    disabled={(ch === 'whatsapp' || ch === 'sms') && !hasPhone}
                    onValueChange={(value) => toggle(type.type, ch, value)}
                  />
                </View>
              ))}
            </Row>
          </View>
        ))
      )}
      <Txt variant="caption" tone={needsPhone ? 'danger' : 'muted'}>
        {needsPhone ? tr('messaging.prefs.phone_required') : tr('messaging.prefs.default_hint')}
      </Txt>
      <Button label={save.isPending ? tr('messaging.prefs.saving') : tr('messaging.prefs.save')} loading={save.isPending} disabled={needsPhone} onPress={() => save.mutate(undefined)} />
    </Card>
  );
}
