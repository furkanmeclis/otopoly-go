import { router, useLocalSearchParams } from 'expo-router';
import { Mail, Pencil, Phone, Trash2 } from 'lucide-react-native';
import { Linking } from 'react-native';

import { Avatar, Badge, Button, Card, ErrorState, Header, IconButton, InfoRow, ListSkeleton, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { qk, useSupplier } from '@/features/queries';
import { suppliersService } from '@/features/suppliers/services/suppliers.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.supplier_detail');

export default function SupplierDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.suppliersRead} title={tr('suppliers.detail.info')}>
      <SupplierDetail />
    </RequirePermission>
  );
}

function SupplierDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  const query = useSupplier(id);
  const supplier = query.data;
  const canWrite = can({ perm: P.suppliersWrite, owner: true });

  const remove = useApiMutation({
    key: 'suppliers.delete',
    fn: () => suppliersService.remove(id),
    invalidate: [qk.suppliers],
    success: tr('suppliers.toast.deleted'),
    toastValidation: true,
    onSuccess: () => {
      log.info('supplier deleted', { uuid: id });
      router.back();
    },
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('suppliers.detail.info')} />}>
        <ListSkeleton rows={4} height={72} />
      </Screen>
    );
  }
  if (query.isError || !supplier) {
    return (
      <Screen header={<Header title={tr('suppliers.detail.info')} />}>
        <ErrorState description={tr('suppliers.error_description')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      header={
        <Header
          title={supplier.name}
          subtitle={supplier.phone || supplier.email || tr('suppliers.description')}
          right={
            canWrite ? (
              <IconButton label={tr('common.edit')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => router.push({ pathname: '/suppliers/form', params: { id: supplier.uuid } })} />
            ) : undefined
          }
        />
      }
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Avatar name={supplier.name} size={48} tone="info" />
        <Txt variant="heading" style={{ flex: 1 }} numberOfLines={2}>
          {supplier.name}
        </Txt>
        <Badge tone={supplier.is_active ? 'success' : 'neutral'} label={supplier.is_active ? tr('common.active') : tr('common.passive')} />
      </Card>

      {supplier.phone || supplier.email ? (
        <Row gap={t.spacing.sm}>
          {supplier.phone ? (
            <Button style={{ flex: 1 }} variant="outline" size="sm" label={supplier.phone} icon={<Phone size={16} color={t.colors.text} />} onPress={() => Linking.openURL(`tel:${supplier.phone.replace(/\s/g, '')}`)} />
          ) : null}
          {supplier.email ? (
            <Button style={{ flex: 1 }} variant="outline" size="sm" label={supplier.email} icon={<Mail size={16} color={t.colors.text} />} onPress={() => Linking.openURL(`mailto:${supplier.email}`)} />
          ) : null}
        </Row>
      ) : null}

      <Section title={tr('suppliers.detail.info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('suppliers.fields.name')} value={supplier.name} />
          <InfoRow label={tr('suppliers.fields.phone')} value={supplier.phone || '—'} />
          <InfoRow label={tr('suppliers.fields.email')} value={supplier.email || '—'} />
          <InfoRow label={tr('suppliers.fields.tax_id')} value={supplier.tax_id || '—'} />
          <InfoRow label={tr('suppliers.fields.notes')} value={supplier.notes || '—'} />
          <InfoRow label={tr('suppliers.created_at')} value={fmt.dateTime(supplier.created_at)} last />
        </Card>
      </Section>

      {canWrite ? (
        <Button
          variant="outline"
          label={tr('suppliers.detail.delete')}
          icon={<Trash2 size={18} color={t.colors.danger} />}
          loading={remove.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('suppliers.detail.delete'), message: tr('suppliers.detail.delete_confirm'), destructive: true, confirmLabel: tr('common.delete') })) remove.mutate(undefined);
          }}
        />
      ) : null}
    </Screen>
  );
}
