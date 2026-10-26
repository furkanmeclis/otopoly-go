/** Package sold — web `/t/[slug]/loyalty/customer-packages/[uuid]`: credits left, sale info, usage history and cancel. */
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Package } from 'lucide-react-native';
import { View } from 'react-native';

import { Badge, Button, DetailHero, ErrorState, Group, Header, InfoRow, LinkValue, ListRow, ListSkeleton, RelatedSection, Screen, Section, StatGrid, Txt, useConfirm, usePullRefresh } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useLiveResource } from '@/features/live/use-live-resource';
import { PACKAGE_STATE_TONE } from '@/features/loyalty/lib/labels';
import { useCustomerPackage, useLoyaltyAccess, useLoyaltyMutations } from '@/features/loyalty/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function CustomerPackageScreen() {
  useLiveResource(['tenant.loyalty.packages', 'tenant.loyalty.customers']);
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.loyaltyRead} title={tr('loyalty.sold.detail')}>
      <CustomerPackageDetail />
    </RequirePermission>
  );
}

function CustomerPackageDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const access = useLoyaltyAccess();
  const confirm = useConfirm();
  const q = useCustomerPackage(id);
  const pull = usePullRefresh(q);
  const { cancelPackage } = useLoyaltyMutations();
  const p = q.data;

  if (q.isLoading) {
    return (
      <Screen header={<Header title={tr('loyalty.sold.detail')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (q.isError || !p) {
    return (
      <Screen header={<Header title={tr('loyalty.sold.detail')} />}>
        <ErrorState error={q.error} description={tr('loyalty.errors.detail')} onRetry={() => q.refetch()} />
      </Screen>
    );
  }

  const left = p.credits_total - p.credits_used;
  const cancel = async () => {
    const ok = await confirm({
      title: tr('loyalty.sold.cancel_title'),
      message: p.credits_used === 0 ? tr('loyalty.sold.cancel_refund') : tr('loyalty.sold.cancel_used'),
      destructive: true,
      confirmLabel: tr('loyalty.sold.cancel_confirm'),
    });
    if (ok) cancelPackage.mutate(p.uuid);
  };

  return (
    <Screen header={<Header title={p.name} subtitle={tr('loyalty.sold.detail')} />} refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <DetailHero
        leading={<Package size={28} color={t.colors.primary} />}
        title={p.name}
        subtitle={p.customer_name}
        badges={<Badge size="sm" tone={PACKAGE_STATE_TONE[p.state]} label={tr(`loyalty.package_state.${p.state}`)} />}
      />
      <StatGrid
        items={[
          { label: tr('loyalty.fields.credits'), value: `${left} / ${p.credits_total}`, tone: left > 0 && p.state === 'active' ? 'success' : 'default' },
          { label: tr('loyalty.fields.price'), value: fmt.money(p.price, p.currency), hint: tr(`loyalty.method.${p.payment_method}`) },
        ]}
      />

      <Section title={tr('loyalty.fields.credits')}>
        <Group>
          {p.credits.map((c, i) => (
            <ListRow
              key={c.service_uuid}
              title={c.service_name}
              subtitle={tr('loyalty.packages.credits_left', { left: c.remaining, total: c.total })}
              right={
                <Txt variant="mono" tone={c.remaining > 0 ? 'success' : 'muted'}>
                  {c.remaining}
                </Txt>
              }
              onPress={can(P.catalogRead) ? () => router.push(`/catalog/services/${c.service_uuid}`) : undefined}
              last={i === p.credits.length - 1}
            />
          ))}
        </Group>
      </Section>

      <Section title={tr('loyalty.sold.info')}>
        <Group>
          <View style={{ paddingHorizontal: t.spacing.lg }}>
            <InfoRow label={tr('loyalty.fields.customer')}>
              <LinkValue label={p.customer_name} onPress={can(P.customersRead) ? () => router.push(`/customers/${p.customer_uuid}`) : undefined} />
            </InfoRow>
            <InfoRow label={tr('loyalty.fields.purchased_at')} value={fmt.dateTime(p.purchased_at)} />
            <InfoRow label={tr('loyalty.fields.expires_at')} value={p.expires_at ? fmt.date(p.expires_at) : tr('loyalty.packages.no_expiry')} />
            <InfoRow label={tr('loyalty.fields.method')} value={tr(`loyalty.method.${p.payment_method}`)} />
            {p.cancelled_at ? <InfoRow label={tr('loyalty.fields.cancelled_at')} value={fmt.dateTime(p.cancelled_at)} /> : null}
            <InfoRow label={tr('loyalty.fields.notes')} value={p.notes || '—'} last />
          </View>
        </Group>
      </Section>

      <RelatedSection
        title={tr('loyalty.usage.title')}
        items={p.usage}
        empty={tr('loyalty.usage.empty_description')}
        renderItem={(u, i, last) => (
          <ListRow
            key={u.uuid}
            title={`${u.plate} · ${u.line_name}`}
            subtitle={`${fmt.dateTime(u.created_at)} · ${tr('loyalty.job.units', { count: u.units })} · −${fmt.money(u.discount_amount, p.currency)}`}
            right={<Badge size="sm" tone={u.status === 'applied' ? 'success' : 'neutral'} label={tr(`loyalty.application_status.${u.status}`)} />}
            onPress={can(P.jobsRead) ? () => router.push(`/jobs/${u.job_uuid}`) : undefined}
            last={last}
          />
        )}
      />

      {access.canWrite && p.state !== 'cancelled' ? (
        <Button variant="outline" label={tr('loyalty.sold.cancel')} icon={<Ban size={16} color={t.colors.danger} />} onPress={cancel} loading={cancelPackage.isPending} />
      ) : null}
    </Screen>
  );
}
