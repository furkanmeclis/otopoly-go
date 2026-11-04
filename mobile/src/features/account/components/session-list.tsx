import { Calendar, Clock, Monitor, Smartphone, Trash2 } from 'lucide-react-native';
import { View } from 'react-native';

import { Badge, Button, Card, ErrorState, IconButton, Row, Skeleton, Txt, useConfirm } from '@/components/ui';
import { accountKeys, useSessions } from '@/features/account/queries';
import { authService, type DeviceSession } from '@/features/account/services/auth.service';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

/** Web `SessionManager`: device list, revoke one (confirm), revoke all others (confirm). */
export function SessionList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const sessions = useSessions();
  const items = sessions.data ?? [];
  const othersExist = items.some((s) => !s.current);

  const revoke = useApiMutation({
    key: 'account.sessions.revoke',
    fn: (uuid: string) => authService.revokeSession(uuid),
    invalidate: [accountKeys.sessions],
    success: tr('auth.sessions.revoke_success'),
    toastValidation: true,
  });
  const revokeOthers = useApiMutation({
    key: 'account.sessions.revoke_others',
    fn: () => authService.revokeOtherSessions(),
    invalidate: [accountKeys.sessions],
    success: tr('auth.sessions.revoke_others_success'),
    toastValidation: true,
  });

  const askRevoke = async (s: DeviceSession) => {
    if (await confirm({ title: tr('auth.sessions.revoke_title'), message: tr('auth.sessions.revoke_description'), destructive: true, confirmLabel: tr('auth.sessions.revoke') })) revoke.mutate(s.uuid);
  };

  if (sessions.isLoading) return <Skeleton height={96} radius={16} />;
  if (sessions.isError) return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="secondary">
          {items.length ? tr('auth.sessions.count', { count: items.length }) : tr('auth.sessions.empty_title')}
        </Txt>
        <Button
          size="sm"
          variant="outline"
          label={revokeOthers.isPending ? tr('auth.sessions.revoking') : tr('auth.sessions.revoke_others')}
          disabled={!othersExist || revokeOthers.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('auth.sessions.revoke_others_title'), message: tr('auth.sessions.revoke_others_description'), destructive: true, confirmLabel: tr('auth.sessions.revoke_others') })) revokeOthers.mutate(undefined);
          }}
        />
      </Row>
      {items.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
          <Monitor size={24} color={t.colors.textMuted} />
          <Txt variant="bodyStrong">{tr('auth.sessions.empty_title')}</Txt>
          <Txt variant="caption" tone="secondary">
            {tr('auth.sessions.empty_body')}
          </Txt>
        </Card>
      ) : (
        items.map((s) => {
          const ua = s.user_agent?.trim() || tr('auth.sessions.unknown_device');
          const mobile = /mobile|iphone|android|ios/i.test(ua);
          const Icon = mobile ? Smartphone : Monitor;
          return (
            <Card key={s.uuid} style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
              <View style={{ width: 40, height: 40, borderRadius: t.radius.sm, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color={t.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Txt variant="bodyStrong">{ua}</Txt>
                <Row gap={6} wrap>
                  {s.current ? <Badge size="sm" tone="success" label={tr('auth.sessions.current')} /> : null}
                  {s.impersonated ? <Badge size="sm" tone="warning" label={tr('auth.sessions.impersonated')} /> : null}
                  {s.ip_address ? <Badge size="sm" label={`${tr('auth.sessions.ip')}: ${s.ip_address}`} /> : null}
                </Row>
                <Row gap={4}>
                  <Calendar size={12} color={t.colors.textMuted} />
                  <Txt variant="caption" tone="muted">{`${tr('auth.sessions.created_at')}: ${fmt.dateTime(s.created_at)}`}</Txt>
                </Row>
                <Row gap={4}>
                  <Clock size={12} color={t.colors.textMuted} />
                  <Txt variant="caption" tone="muted">{`${tr('auth.sessions.expires_at')}: ${fmt.dateTime(s.expires_at)}`}</Txt>
                </Row>
              </View>
              <IconButton variant="ghost" label={tr('auth.sessions.revoke')} icon={<Trash2 size={18} color={t.colors.danger} />} disabled={revoke.isPending && revoke.variables === s.uuid} onPress={() => askRevoke(s)} />
            </Card>
          );
        })
      )}
    </View>
  );
}
