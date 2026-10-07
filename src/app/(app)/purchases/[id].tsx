import { router, useLocalSearchParams } from 'expo-router';
import { Ban } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Button, Card, ErrorState, Group, Header, InfoRow, ListRow, ListSkeleton, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { purchasesService } from '@/features/purchases/services/purchases.service';
import { MONEY_KEYS, usePurchase } from '@/features/queries';
import { DocStatusBadge } from '@/features/sales/components/commerce-parts';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.purchase_detail');

export default function PurchaseDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.purchasesRead} title={tr('purchases.detail.title')}>
      <PurchaseDetail />
    </RequirePermission>
  );
}

function PurchaseDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  const query = usePurchase(id);
  const purchase = query.data;
  const canWrite = can({ perm: P.purchasesWrite, owner: true });

  const voidPurchase = useApiMutation({
    key: 'purchases.void',
    fn: () => purchasesService.void(id),
    invalidate: MONEY_KEYS,
    success: tr('purchases.toast.voided'),
    toastValidation: true,
    onSuccess: () => log.info('purchase voided', { uuid: id }),
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('purchases.detail.title')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (query.isError || !purchase) {
    return (
      <Screen header={<Header title={tr('purchases.detail.title')} />}>
        <ErrorState error={query.error} description={tr('purchases.detail.error')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const lines = purchase.lines ?? [];

  return (
    <Screen header={<Header title={purchase.supplier_name} subtitle={tr('purchases.detail.description')} />} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
        <DocStatusBadge ns="purchases" status={purchase.status} size="md" />
        <Txt variant="display" style={{ fontVariant: ['tabular-nums'], textDecorationLine: purchase.status === 'voided' ? 'line-through' : 'none' }}>
          {fmt.money(purchase.total_amount, purchase.currency)}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {tr(`purchases.payment_method.${purchase.method}`)} · {fmt.dateTime(purchase.purchased_at)}
        </Txt>
      </Card>

      <Section title={tr('purchases.detail.info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('purchases.supplier')}>
            <Pressable onPress={() => router.push(`/suppliers/${purchase.supplier_uuid}`)} accessibilityRole="link" hitSlop={8} disabled={!can(P.suppliersRead)}>
              <Txt variant="bodyStrong" tone={can(P.suppliersRead) ? 'primary' : 'default'}>
                {purchase.supplier_name}
              </Txt>
            </Pressable>
          </InfoRow>
          <InfoRow label={tr('purchases.method')} value={tr(`purchases.payment_method.${purchase.method}`)} />
          <InfoRow label={tr('purchases.finance_account')} value={purchase.finance_account_name || '—'} />
          <InfoRow label={tr('purchases.purchased_at')} value={fmt.dateTime(purchase.purchased_at)} />
          <InfoRow label={tr('purchases.voided_at')} value={purchase.voided_at ? fmt.dateTime(purchase.voided_at) : '—'} />
          <InfoRow label={tr('purchases.notes')} value={purchase.notes || '—'} last />
        </Card>
      </Section>

      <Section title={`${tr('purchases.detail.lines')} (${lines.length})`}>
        <Group>
          {lines.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('purchases.detail.lines_empty')}
            </Txt>
          ) : (
            lines.map((line, i) => (
              <ListRow
                key={line.uuid}
                title={line.name}
                subtitle={`${fmt.money(line.unit_cost, line.currency)} × ${fmt.number(line.qty, 3)}`}
                right={<Txt variant="mono">{fmt.money(line.line_total, line.currency)}</Txt>}
                chevron={false}
                last={i === lines.length - 1}
              />
            ))
          )}
        </Group>
      </Section>

      {canWrite && purchase.status === 'posted' ? (
        <Button
          variant="outline"
          label={tr('purchases.actions.void')}
          icon={<Ban size={18} color={t.colors.danger} />}
          loading={voidPurchase.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('purchases.void.title'), message: tr('purchases.void.description'), confirmLabel: tr('purchases.void.confirm'), destructive: true })) voidPurchase.mutate(undefined);
          }}
        />
      ) : null}
    </Screen>
  );
}
