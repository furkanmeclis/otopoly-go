import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, Power, UserCog } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Header, IconButton, ListSkeleton, Row, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { ownerOnly, P } from '@/features/auth/permissions';
import { billingService } from '@/features/billing/services/billing.service';
import { qk, useStaff } from '@/features/queries';
import { ResetPasswordSheet, StaffCreateSheet } from '@/features/staff/components/staff-sheets';
import { staffService, type StaffMember } from '@/features/staff/services/staff.service';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

/** Web `useTenantStaffAccess`: writes need the owner membership + `tenant.staff.write`. */
const STAFF_WRITE = ownerOnly(P.staffWrite);

export default function StaffScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.staffRead} title={tr('staff.title')}>
      <StaffList />
    </RequirePermission>
  );
}

function StaffList() {
  const t = useTheme();
  const { t: tr, fmt, locale } = useLocale();
  const { can, me } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(STAFF_WRITE);
  const list = useStaff();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<StaffMember | null>(null);

  // Web `MeterFor keyName="staff.count"`: plan seat usage, only when billing is readable.
  const billing = useQuery({ queryKey: [...qk.billing, 'overview'], queryFn: () => billingService.overview(), enabled: can(P.billingRead), retry: false });
  const meter = billing.data?.meters.find((m) => m.key === 'staff.count' && m.kind === 'limit');

  const patch = useApiMutation({
    key: 'staff.patch',
    fn: (v: { uuid: string; status: 'active' | 'inactive' }) => staffService.patch(v.uuid, { status: v.status }),
    invalidate: [qk.staff, qk.billing],
    success: tr('staff.toast.updated'),
    toastValidation: true,
  });

  const toggle = async (m: StaffMember) => {
    const next = m.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !(await confirm({ title: tr('staff.actions.deactivate'), message: tr('mobile.catalog.staff_deactivate_confirm', { name: `${m.name} ${m.surname}` }), destructive: true, confirmLabel: tr('staff.actions.deactivate') }))) return;
    patch.mutate({ uuid: m.uuid, status: next });
  };

  const items = list.data?.items ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('staff.title')}
        subtitle={tr('staff.description')}
        right={canWrite ? <IconButton variant="primary" label={tr('staff.actions.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => setCreateOpen(true)} /> : undefined}
      />
      <FlatList
        data={items}
        keyExtractor={(m) => m.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          meter ? (
            <Card style={{ gap: 6, marginBottom: t.spacing.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="caption" tone="secondary">
                  {locale === 'en' ? meter.label_en : meter.label_tr}
                </Txt>
                <Txt variant="bodyStrong">{meter.limit != null ? `${meter.used} / ${meter.limit}` : String(meter.used)}</Txt>
              </Row>
              {meter.limit ? (
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}>
                  <View
                    style={{
                      width: `${Math.min(100, (meter.used / meter.limit) * 100)}%`,
                      height: 6,
                      backgroundColor: meter.used >= meter.limit ? t.colors.danger : (meter.used / meter.limit) * 100 >= meter.warn_pct ? t.colors.warning : t.colors.primary,
                    }}
                  />
                </View>
              ) : null}
            </Card>
          ) : null
        }
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor={t.colors.primary} />}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={4} height={96} />
          ) : list.isError ? (
            <ErrorState description={tr('staff.load_error')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState icon={<UserCog size={28} color={t.colors.textMuted} />} title={tr('staff.empty')} action={canWrite ? <Button label={tr('staff.actions.create')} onPress={() => setCreateOpen(true)} /> : undefined} />
          )
        }
        renderItem={({ item: m }) => {
          const fullName = `${m.name} ${m.surname}`;
          const isOwner = m.role === 'owner';
          const isMe = m.uuid === me?.user.uuid;
          return (
            <Card style={{ gap: t.spacing.md }} accessibilityLabel={fullName}>
              <Row gap={t.spacing.md}>
                <Avatar name={fullName} size={42} tone={m.status === 'active' ? 'primary' : 'neutral'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}>
                    <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {fullName}
                    </Txt>
                    {isMe ? (
                      <Txt variant="caption" tone="muted">
                        {tr('mobile.catalog.staff_you')}
                      </Txt>
                    ) : null}
                  </Row>
                  <Txt variant="caption" tone="secondary" numberOfLines={1}>
                    {m.email}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {`${tr('staff.created_at')}: ${fmt.date(m.created_at)}`}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge size="sm" tone={m.status === 'active' ? 'success' : 'danger'} label={tr(`staff.status.${m.status}`)} />
                  <Badge size="sm" tone={isOwner ? 'primary' : 'neutral'} label={tr(`organizations.roles.${isOwner ? 'owner' : 'staff'}`)} />
                </View>
              </Row>
              {canWrite && !isOwner ? (
                <Row gap={t.spacing.sm}>
                  <Button
                    style={{ flex: 1 }}
                    size="sm"
                    variant="outline"
                    icon={<Power size={14} color={m.status === 'active' ? t.colors.danger : t.colors.success} />}
                    label={m.status === 'active' ? tr('staff.actions.deactivate') : tr('staff.actions.activate')}
                    disabled={patch.isPending}
                    onPress={() => toggle(m)}
                  />
                  <Button style={{ flex: 1 }} size="sm" variant="outline" icon={<KeyRound size={14} color={t.colors.text} />} label={tr('staff.actions.reset_password')} onPress={() => setResetFor(m)} />
                </Row>
              ) : null}
            </Card>
          );
        }}
      />
      <StaffCreateSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
      <ResetPasswordSheet member={resetFor} onClose={() => setResetFor(null)} />
    </SafeAreaView>
  );
}
