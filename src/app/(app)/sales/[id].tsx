import { router, useLocalSearchParams } from 'expo-router';
import { Ban } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Button, Card, ErrorState, Group, Header, InfoRow, ListRow, ListSkeleton, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { MONEY_KEYS, useSale } from '@/features/queries';
import { DocStatusBadge } from '@/features/sales/components/commerce-parts';
import { salesService } from '@/features/sales/services/sales.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.sale_detail');

export default function SaleDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.salesRead} title={tr('sales.detail.title')}>
      <SaleDetail />
    </RequirePermission>
  );
}

function SaleDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  const query = useSale(id);
  const sale = query.data;
  // Web `useTenantSalesAccess`: void = owner membership + sales.write.
  const canVoid = can({ perm: P.salesWrite, owner: true });

  const voidSale = useApiMutation({
    key: 'sales.void',
    fn: () => salesService.void(id),
    invalidate: MONEY_KEYS,
    success: tr('sales.toast.voided'),
    toastValidation: true,
    onSuccess: () => log.info('sale voided', { uuid: id }),
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('sales.detail.title')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (query.isError || !sale) {
    return (
      <Screen header={<Header title={tr('sales.detail.title')} />}>
        <ErrorState error={query.error} description={tr('sales.detail.error')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const title = sale.customer_name || tr('sales.walk_in');
  const lines = sale.lines ?? [];

  return (
    <Screen header={<Header title={title} subtitle={sale.customer_phone || tr('sales.detail.description')} />} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
        <DocStatusBadge ns="sales" status={sale.status} size="md" />
        <Txt variant="display" style={{ fontVariant: ['tabular-nums'], textDecorationLine: sale.status === 'voided' ? 'line-through' : 'none' }}>
          {fmt.money(sale.total_amount, sale.currency)}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {tr(`sales.payment_method.${sale.method}`)} · {fmt.dateTime(sale.sold_at)}
        </Txt>
      </Card>

      <Section title={tr('sales.detail.info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('sales.customer')}>
            {sale.customer_uuid && can(P.customersRead) ? (
              <Pressable onPress={() => router.push(`/customers/${sale.customer_uuid}`)} accessibilityRole="link" hitSlop={8}>
                <Txt variant="bodyStrong" tone="primary">
                  {sale.customer_name}
                </Txt>
              </Pressable>
            ) : (
              <Txt variant="bodyStrong">{sale.customer_uuid ? sale.customer_name : tr('sales.walk_in')}</Txt>
            )}
          </InfoRow>
          <InfoRow label={tr('sales.method')} value={tr(`sales.payment_method.${sale.method}`)} />
          <InfoRow label={tr('sales.finance_account')} value={sale.finance_account_name || '—'} />
          <InfoRow label={tr('sales.sold_at')} value={fmt.dateTime(sale.sold_at)} />
          <InfoRow label={tr('sales.voided_at')} value={sale.voided_at ? fmt.dateTime(sale.voided_at) : '—'} />
          <InfoRow label={tr('sales.notes')} value={sale.notes || '—'} last />
        </Card>
      </Section>

      <Section title={`${tr('sales.detail.lines')} (${lines.length})`}>
        <Group>
          {lines.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('sales.detail.lines_empty')}
            </Txt>
          ) : (
            lines.map((line, i) => (
              <ListRow
                key={line.uuid}
                title={line.name}
                subtitle={`${fmt.money(line.unit_price, line.currency)} × ${fmt.number(line.qty, 3)}`}
                right={<Txt variant="mono">{fmt.money(line.line_total, line.currency)}</Txt>}
                chevron={false}
                last={i === lines.length - 1}
              />
            ))
          )}
        </Group>
      </Section>

      {canVoid && sale.status === 'posted' ? (
        <View>
          <Button
            variant="outline"
            label={tr('sales.actions.void')}
            icon={<Ban size={18} color={t.colors.danger} />}
            loading={voidSale.isPending}
            onPress={async () => {
              if (await confirm({ title: tr('sales.void.title'), message: tr('sales.void.description'), confirmLabel: tr('sales.void.confirm'), destructive: true })) voidSale.mutate(undefined);
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
