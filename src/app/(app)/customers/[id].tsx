import { router, useLocalSearchParams } from 'expo-router';
import { Car, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import {
  Amount,
  Badge,
  Button,
  Card,
  ErrorState,
  Group,
  Header,
  IconButton,
  InfoRow,
  ListRow,
  ListSkeleton,
  PlateBadge,
  Row,
  Screen,
  Section,
  Txt,
  useConfirm,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { AddVehicleSheet } from '@/features/customers/components/pickers';
import { customersService } from '@/features/customers/services/customers.service';
import { JobStatusBadge } from '@/features/jobs/components/job-parts';
import { qk, useCariEntriesInfinite, useCustomer, useCustomerJobs, useTodos } from '@/features/queries';
import { TodoRow } from '@/features/todos/components/todo-row';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function CustomerDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.customersRead} title={tr('customers.detail.info')}>
      <CustomerDetail />
    </RequirePermission>
  );
}

function CustomerDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  const customer = useCustomer(id);
  const jobs = useCustomerJobs(can(P.jobsRead) ? id : '');
  const c = customer.data;
  const cari = useCariEntriesInfinite(can(P.cariRead) && c?.cari_account_uuid ? c.cari_account_uuid : '', { limit: 5 });
  const todos = useTodos({ customer: id, limit: 10 }, can(P.todosRead));
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const canWrite = can(P.customersWrite);

  const remove = useApiMutation({
    key: 'customers.delete',
    fn: () => customersService.remove(id),
    invalidate: [qk.customers],
    success: tr('customers.toast.deleted'),
    toastValidation: true,
    onSuccess: () => router.back(),
  });
  const removeVehicle = useApiMutation({
    key: 'customers.vehicle.remove',
    fn: (uuid: string) => customersService.removeVehicle(uuid),
    invalidate: [qk.customers],
    success: tr('customers.toast.vehicle_removed'),
    toastValidation: true,
  });

  if (customer.isLoading) {
    return (
      <Screen header={<Header title={tr('customers.detail.info')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (customer.isError || !c) {
    return (
      <Screen header={<Header title={tr('customers.detail.info')} />}>
        <ErrorState description={tr('customers.error_description')} onRetry={() => customer.refetch()} />
      </Screen>
    );
  }
  const balance = toNumber(c.cari_balance);

  return (
    <Screen
      header={
        <Header
          title={c.name}
          subtitle={tr(`customers.kind.${c.kind}`)}
          right={canWrite ? <IconButton label={tr('common.edit')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => router.push({ pathname: '/customers/form', params: { id: c.uuid } })} /> : undefined}
        />
      }
      refreshing={customer.isRefetching}
      onRefresh={() => void customer.refetch()}
    >
      <Row gap={t.spacing.sm}>
        {c.phone ? <Button style={{ flex: 1 }} variant="outline" size="sm" label={c.phone} icon={<Phone size={16} color={t.colors.text} />} onPress={() => Linking.openURL(`tel:${c.phone.replace(/\s/g, '')}`)} /> : null}
        {can(P.jobsWrite) ? <Button style={{ flex: 1 }} size="sm" label={tr('jobs.actions.create')} icon={<Plus size={16} color={t.colors.onPrimary} />} onPress={() => router.push('/jobs/new')} /> : null}
      </Row>

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('customers.fields.phone')} value={c.phone} />
        <InfoRow label={tr('customers.fields.email')}>
          {c.email ? (
            <Pressable onPress={() => Linking.openURL(`mailto:${c.email}`)} accessibilityRole="link">
              <Row gap={4}>
                <Mail size={14} color={t.colors.primary} />
                <Txt tone="primary" variant="bodyStrong">
                  {c.email}
                </Txt>
              </Row>
            </Pressable>
          ) : (
            <Txt variant="bodyStrong">—</Txt>
          )}
        </InfoRow>
        {c.kind === 'company' ? (
          <>
            <InfoRow label={tr('customers.fields.tax_id')} value={c.tax_id} />
            <InfoRow label={tr('customers.fields.tax_office')} value={c.tax_office} />
          </>
        ) : null}
        <InfoRow label={tr('customers.fields.active')}>
          <Badge size="sm" tone={c.is_active ? 'success' : 'neutral'} label={c.is_active ? tr('common.active') : tr('common.passive')} />
        </InfoRow>
        <InfoRow label={tr('customers.created_at')} value={fmt.date(c.created_at)} />
        <InfoRow label={tr('customers.fields.notes')} value={c.notes || '—'} last />
      </Card>

      <Section title={tr('customers.detail.vehicles')} action={canWrite ? { label: tr('customers.detail.add_vehicle'), onPress: () => setVehicleOpen(true) } : undefined}>
        <Group>
          {c.vehicles.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('customers.detail.no_vehicles')}
            </Txt>
          ) : (
            c.vehicles.map((v, i) => (
              <ListRow
                key={v.uuid}
                title={`${v.brand_name} ${v.model_name}`}
                subtitle={String(v.year)}
                left={<PlateBadge plate={v.plate} size="sm" />}
                right={
                  canWrite ? (
                    <IconButton
                      variant="ghost"
                      label={tr('common.delete')}
                      icon={<Trash2 size={16} color={t.colors.danger} />}
                      onPress={async () => {
                        if (await confirm({ title: v.plate, message: tr('customers.detail.remove_vehicle_confirm'), destructive: true, confirmLabel: tr('common.delete') })) removeVehicle.mutate(v.uuid);
                      }}
                    />
                  ) : undefined
                }
                chevron={false}
                last={i === c.vehicles.length - 1}
              />
            ))
          )}
        </Group>
      </Section>

      {can(P.cariRead) ? (
        <Section
          title={tr('customers.detail.recent_cari_entries')}
          action={c.cari_account_uuid ? { label: tr('customers.detail.view_cari'), onPress: () => router.push(`/cari/${c.cari_account_uuid}`) } : undefined}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt tone="secondary">{tr('cari.balance')}</Txt>
            <Amount value={balance} variant="title" tone={balance > 0 ? 'danger' : balance < 0 ? 'success' : 'default'} />
          </Card>
          <Group>
            {cari.items.length === 0 ? (
              <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
                {tr('customers.detail.no_cari_entries')}
              </Txt>
            ) : (
              cari.items.slice(0, 5).map((e, i, arr) => (
                <ListRow
                  key={e.uuid}
                  title={e.description || tr(`cari.entry_type.${e.type}`)}
                  subtitle={`${fmt.date(e.entry_date)} · ${tr(`cari.entry_type.${e.type}`)}`}
                  right={
                    <Txt variant="mono" tone={e.status === 'void' ? 'muted' : e.type === 'payment' ? 'success' : 'default'} style={e.status === 'void' ? { textDecorationLine: 'line-through' } : undefined}>
                      {e.type === 'payment' ? '-' : '+'}
                      {fmt.money(e.amount)}
                    </Txt>
                  }
                  chevron={false}
                  last={i === arr.length - 1}
                />
              ))
            )}
          </Group>
        </Section>
      ) : null}

      {can(P.jobsRead) ? (
        <Section title={tr('customers.detail.recent_jobs')}>
          <Group>
            {(jobs.data?.items ?? []).length === 0 ? (
              <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
                {tr('customers.detail.no_jobs')}
              </Txt>
            ) : (
              (jobs.data?.items ?? []).map((j, i, arr) => (
                <ListRow
                  key={j.uuid}
                  title={`${j.plate} · ${fmt.money(j.total_amount, j.currency)}`}
                  subtitle={`${fmt.dateTime(j.started_at)} · ${(j.services ?? []).map((s) => s.name).join(', ')}`}
                  left={<Car size={18} color={t.colors.textMuted} />}
                  right={<JobStatusBadge status={j.status} size="sm" />}
                  onPress={() => router.push(`/jobs/${j.uuid}`)}
                  last={i === arr.length - 1}
                />
              ))
            )}
          </Group>
        </Section>
      ) : null}

      {can(P.todosRead) && (todos.data?.items ?? []).length > 0 ? (
        <Section title={tr('todos.title')}>
          <Group>
            {(todos.data?.items ?? []).map((todo, i, arr) => (
              <TodoRow key={todo.uuid} todo={todo} canWrite={can(P.todosWrite)} last={i === arr.length - 1} />
            ))}
          </Group>
        </Section>
      ) : null}

      {canWrite ? (
        <Button
          variant="outline"
          label={tr('customers.detail.delete')}
          icon={<Trash2 size={18} color={t.colors.danger} />}
          loading={remove.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('customers.detail.delete'), message: tr('customers.detail.delete_confirm'), destructive: true, confirmLabel: tr('common.delete') })) remove.mutate(undefined);
          }}
        />
      ) : null}

      <View>
        <AddVehicleSheet customerUuid={c.uuid} visible={vehicleOpen} onClose={() => setVehicleOpen(false)} onCreated={() => setVehicleOpen(false)} />
      </View>
    </Screen>
  );
}
