import { router, useLocalSearchParams } from 'expo-router';
import { Mail, MessageCircle, Pencil, Phone, Plus, Trash2 } from 'lucide-react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  DetailHero,
  ErrorState,
  Header,
  IconButton,
  InfoRow,
  ListRow,
  ListSkeleton,
  QuickActions,
  RelatedSection,
  Screen,
  Section,
  StatGrid,
  useConfirm,
  usePullRefresh,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { qk, useSupplier, useSupplierPurchases } from '@/features/queries';
import { DocStatusBadge } from '@/features/sales/components/commerce-parts';
import { suppliersService } from '@/features/suppliers/services/suppliers.service';
import { contact } from '@/lib/contact';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

const log = createLogger('screen.supplier_detail');

export default function SupplierDetailScreen() {
  useLiveResource(['tenant.suppliers', 'tenant.purchases']);
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
  const canPurchase = can({ perm: P.purchasesWrite, owner: true });
  const purchases = useSupplierPurchases(id, can(P.purchasesRead));
  // Totals over the posted purchases (voided ones do not count).
  const posted = useSupplierPurchases(id, can(P.purchasesRead), { status: 'posted', limit: 100 });
  const pull = usePullRefresh(query, can(P.purchasesRead) && purchases, can(P.purchasesRead) && posted);

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
        <ErrorState error={query.error} description={tr('suppliers.error_description')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const phone = supplier.phone?.trim();
  const postedItems = posted.data?.items ?? [];
  const purchasedTotal = postedItems.reduce((sum, x) => sum + toNumber(x.total_amount), 0);
  const lastPurchase = postedItems[0];

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
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
    >
      <DetailHero
        leading={<Avatar name={supplier.name} size={52} tone="info" />}
        title={supplier.name}
        subtitle={[phone, supplier.email].filter(Boolean).join(' · ') || undefined}
        badges={<Badge size="sm" tone={supplier.is_active ? 'success' : 'neutral'} label={supplier.is_active ? tr('common.active') : tr('common.passive')} />}
      >
        <QuickActions
          actions={[
            phone && { key: 'call', label: tr('mobile.detail.call'), icon: <Phone size={20} color={t.colors.primary} />, onPress: () => contact.call(phone) },
            phone && { key: 'wa', label: tr('mobile.detail.whatsapp'), icon: <MessageCircle size={20} color={t.colors.primary} />, onPress: () => contact.whatsapp(phone) },
            supplier.email && { key: 'mail', label: tr('mobile.detail.email'), icon: <Mail size={20} color={t.colors.primary} />, onPress: () => contact.email(supplier.email) },
            canPurchase && {
              key: 'purchase',
              label: tr('purchases.actions.create'),
              tone: 'primary',
              icon: <Plus size={20} color={t.colors.onPrimary} />,
              onPress: () => router.push({ pathname: '/purchases/new', params: { supplier: supplier.uuid } }),
            },
          ]}
        />
      </DetailHero>

      {can(P.purchasesRead) ? (
        <>
          <StatGrid
            items={[
              { label: tr('purchases.summary.count'), value: String(posted.data?.total ?? 0), loading: posted.isLoading },
              { label: tr('purchases.summary.total'), value: fmt.money(purchasedTotal), loading: posted.isLoading },
              { label: tr('purchases.purchased_at'), value: lastPurchase ? fmt.date(lastPurchase.purchased_at) : tr('mobile.detail.never'), loading: posted.isLoading },
            ]}
          />
          <RelatedSection
            title={tr('purchases.title')}
            items={purchases.data?.items}
            count={purchases.data?.total}
            loading={purchases.isLoading}
            error={purchases.error}
            onRetry={() => void purchases.refetch()}
            empty={tr('purchases.empty_title')}
            renderItem={(x, i, last) => (
              <ListRow
                key={x.uuid}
                title={fmt.money(x.total_amount, x.currency)}
                subtitle={`${fmt.dateTime(x.purchased_at)} · ${tr(`purchases.payment_method.${x.method}`)}`}
                right={<DocStatusBadge ns="purchases" status={x.status} />}
                onPress={() => router.push(`/purchases/${x.uuid}`)}
                last={last}
              />
            )}
          />
        </>
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
