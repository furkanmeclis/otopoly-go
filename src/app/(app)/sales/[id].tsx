import { router, useLocalSearchParams } from 'expo-router';
import { Ban, MessageCircle, Phone, ReceiptText, User, Wallet } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, Card, ErrorState, Group, Header, InfoRow, LinkValue, ListRow, ListSkeleton, QuickActions, Screen, Section, StatGrid, Txt, useConfirm, usePullRefresh } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { MONEY_KEYS, useCustomer, useSale } from '@/features/queries';
import { DocStatusBadge } from '@/features/sales/components/commerce-parts';
import { salesService } from '@/features/sales/services/sales.service';
import { contact } from '@/lib/contact';
import { toNumber } from '@/lib/i18n/format';
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
  // Customer record for the cari statement link of a cari sale.
  const customer = useCustomer(can(P.customersRead) && sale?.method === 'cari' ? sale.customer_uuid : null);
  const pull = usePullRefresh(query);
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
  const phone = sale.customer_phone?.trim();
  const openCustomer = sale.customer_uuid && can(P.customersRead) ? () => router.push(`/customers/${sale.customer_uuid}`) : undefined;
  const cariAccount = customer.data?.cari_account_uuid;
  const openPayment =
    sale.finance_transaction_uuid && can(P.financeRead)
      ? () => router.push(`/finance/transactions/${sale.finance_transaction_uuid}`)
      : sale.method === 'cari' && cariAccount && can(P.cariRead)
        ? () => router.push(`/cari/${cariAccount}`)
        : undefined;
  const qtyTotal = lines.reduce((sum, l) => sum + toNumber(l.qty), 0);

  return (
    <Screen header={<Header title={title} subtitle={sale.customer_phone || tr('sales.detail.description')} />} refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
        <DocStatusBadge ns="sales" status={sale.status} size="md" />
        <Txt variant="display" style={{ fontVariant: ['tabular-nums'], textDecorationLine: sale.status === 'voided' ? 'line-through' : 'none' }}>
          {fmt.money(sale.total_amount, sale.currency)}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {tr(`sales.payment_method.${sale.method}`)} · {fmt.dateTime(sale.sold_at)}
        </Txt>
        <QuickActions
          actions={[
            openCustomer && { key: 'customer', label: tr('sales.customer'), icon: <User size={20} color={t.colors.primary} />, onPress: openCustomer },
            phone && { key: 'call', label: tr('mobile.detail.call'), icon: <Phone size={20} color={t.colors.primary} />, onPress: () => contact.call(phone) },
            phone && { key: 'wa', label: tr('mobile.detail.whatsapp'), icon: <MessageCircle size={20} color={t.colors.primary} />, onPress: () => contact.whatsapp(phone) },
            openPayment && { key: 'payment', label: tr(`sales.payment_method.${sale.method}`), icon: sale.method === 'cari' ? <ReceiptText size={20} color={t.colors.primary} /> : <Wallet size={20} color={t.colors.primary} />, onPress: openPayment },
          ]}
        />
      </Card>

      <StatGrid
        items={[
          { label: tr('sales.detail.lines'), value: String(lines.length) },
          { label: tr('sales.qty'), value: fmt.number(qtyTotal, 3) },
        ]}
      />

      <Section title={tr('sales.detail.info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('sales.customer')}>
            <LinkValue label={sale.customer_uuid ? sale.customer_name : tr('sales.walk_in')} onPress={openCustomer} />
          </InfoRow>
          <InfoRow label={tr('sales.method')}>
            <LinkValue label={tr(`sales.payment_method.${sale.method}`)} onPress={openPayment} />
          </InfoRow>
          <InfoRow label={tr('sales.finance_account')}>
            <LinkValue
              label={sale.finance_account_name || '—'}
              onPress={sale.finance_account_uuid && can(P.financeRead) ? () => router.push(`/finance/accounts/${sale.finance_account_uuid}`) : undefined}
            />
          </InfoRow>
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
                onPress={can(P.catalogRead) ? () => router.push(`/catalog/products/${line.product_uuid}`) : undefined}
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
