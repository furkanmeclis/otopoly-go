import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Share2 } from 'lucide-react-native';
import { Pressable, Share, View } from 'react-native';

import { Badge, Button, Card, ErrorState, Header, IconButton, InfoRow, ListSkeleton, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { paymentMethodKey, TxnIcon, txnTypeKey } from '@/features/finance/components/finance-parts';
import { SourceCard } from '@/features/finance/components/source-card';
import { reportId, txnStatusHintKey, txnStatusKey } from '@/features/finance/lib';
import { financeService, type FinanceTransaction } from '@/features/finance/services/finance.service';
import { MONEY_KEYS, useTransaction } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';
import { useLiveResource } from '@/features/live/use-live-resource';

const log = createLogger('screen.finance.transaction');

export default function FinanceTransactionDetailScreen() {
  useLiveResource('tenant.finance.transactions');
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.detail.transaction_title')}>
      <TransactionDetail />
    </RequirePermission>
  );
}

function TransactionDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  // Web: canWrite = owner membership && tenant.finance.write (backend RequireOrgRole("owner") on void).
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const confirm = useConfirm();
  const query = useTransaction(id);
  const tx = query.data;

  const voidTx = useApiMutation({
    key: 'finance.transaction.void',
    fn: () => financeService.voidTransaction(id),
    invalidate: MONEY_KEYS,
    success: tr('mobile.finance.transaction_voided'),
    toastValidation: true,
    onSuccess: (res) => log.info('transaction voided', { uuid: res.uuid }),
  });

  const title = tx ? `${tr(txnTypeKey(tx.type))} · ${fmt.date(`${tx.transaction_date}T12:00:00`)}` : tr('finance.detail.transaction_title');

  if (query.isLoading) {
    return (
      <Screen header={<Header title={title} />}>
        <ListSkeleton rows={3} height={120} />
      </Screen>
    );
  }
  if (query.isError || !tx) {
    return (
      <Screen header={<Header title={title} />}>
        <ErrorState error={query.error} description={tr('finance.detail.transaction_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const isVoid = tx.status === 'void';
  const payKey = tx.payment_method ? paymentMethodKey(tx.payment_method) : null;
  const paymentLabel = payKey ? tr(payKey) : tx.payment_method || '—';
  const amountTone = isVoid ? 'muted' : tx.type === 'income' ? 'success' : tx.type === 'expense' ? 'danger' : 'default';

  const onVoid = async () => {
    const ok = await confirm({
      title: tr('finance.detail.void_title'),
      message: tr('finance.detail.void_description'),
      confirmLabel: tr('finance.transactions.void'),
      destructive: true,
    });
    if (ok) voidTx.mutate(undefined);
  };

  const onShare = () => {
    Share.share({ message: shareText(tx, tr, fmt, paymentLabel) }).catch((e) => log.warn('share failed', { error: String(e) }));
  };

  return (
    <Screen
      header={
        <Header
          title={title}
          subtitle={tr('finance.detail.transaction_description')}
          right={<IconButton label={tr('mobile.finance.share_report')} icon={<Share2 size={18} color={t.colors.text} />} onPress={onShare} />}
        />
      }
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      footer={
        canWrite && !isVoid ? (
          <Button variant="danger" label={tr('finance.transactions.void')} icon={<Ban size={18} color={t.colors.textInverse} />} loading={voidTx.isPending} onPress={onVoid} />
        ) : undefined
      }
    >
      <Card style={{ gap: t.spacing.md, opacity: isVoid ? 0.92 : 1 }}>
        <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
          <TxnIcon type={tx.type} />
          <View style={{ flex: 1, gap: 4 }}>
            <Row gap={t.spacing.sm} wrap>
              <Txt variant="heading">{tr(txnTypeKey(tx.type))}</Txt>
              <Badge size="sm" tone={isVoid ? 'neutral' : 'success'} label={tr(txnStatusKey(tx.status))} />
            </Row>
            <Txt variant="caption" tone="secondary">
              {tr('finance.detail.report_id')}: <Txt variant="caption" style={{ fontVariant: ['tabular-nums'], fontWeight: '700' }} selectable>{reportId(tx)}</Txt>
            </Txt>
          </View>
        </Row>
        <View style={{ gap: 2 }}>
          <Txt variant="label" tone="secondary">
            {tr('finance.transactions.amount')}
          </Txt>
          <Txt
            variant="display"
            tone={amountTone}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[{ fontVariant: ['tabular-nums'] }, isVoid ? { textDecorationLine: 'line-through' } : null]}
          >
            {fmt.money(tx.amount, tx.currency)}
          </Txt>
          <Txt variant="caption" tone="muted">
            {tr(txnStatusHintKey(tx.status))}
          </Txt>
        </View>
      </Card>

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('finance.transactions.date')} value={fmt.date(`${tx.transaction_date}T12:00:00`)} />
        <InfoRow label={tr('finance.transactions.account')}>
          <LinkText label={tx.account_name} onPress={() => router.push(`/finance/accounts/${tx.account_uuid}`)} />
        </InfoRow>
        {tx.type === 'transfer' ? (
          <InfoRow label={tr('finance.transfers.to')}>
            {tx.counter_account_uuid && tx.counter_account_name ? (
              <LinkText label={tx.counter_account_name} onPress={() => router.push(`/finance/accounts/${tx.counter_account_uuid}`)} />
            ) : (
              <Txt variant="bodyStrong">—</Txt>
            )}
          </InfoRow>
        ) : (
          <InfoRow label={tr('finance.transactions.category')}>
            {tx.category_uuid && tx.category_name ? (
              <LinkText label={tx.category_name} onPress={() => router.push(`/finance/categories/${tx.category_uuid}`)} />
            ) : (
              <Txt variant="bodyStrong">—</Txt>
            )}
          </InfoRow>
        )}
        <InfoRow label={tr('finance.transactions.currency')} value={tx.currency} />
        <InfoRow label={tr('finance.detail.payment_method')} value={paymentLabel} />
        <InfoRow label={tr('finance.detail.reference_no')} value={tx.reference_no ?? '—'} last />
      </Card>

      {tx.description ? (
        <Section title={tr('finance.transactions.description')}>
          <Card>
            <Txt selectable>{tx.description}</Txt>
          </Card>
        </Section>
      ) : null}

      {tx.source_detail ? (
        <Section title={tr('finance.detail.source')}>
          <SourceCard detail={tx.source_detail} currency={tx.currency} />
        </Section>
      ) : tx.source_type || tx.source_uuid ? (
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('finance.detail.source_type')} value={sourceTypeLabel(tr, tx.source_type)} last />
        </Card>
      ) : null}

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('finance.detail.created_at')} value={fmt.dateTime(tx.created_at)} />
        <InfoRow label={tr('finance.detail.updated_at')} value={fmt.dateTime(tx.updated_at)} last={!tx.voided_at} />
        {tx.voided_at ? <InfoRow label={tr('finance.detail.voided_at')} value={fmt.dateTime(tx.voided_at)} last /> : null}
      </Card>
    </Screen>
  );
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link" style={{ flexShrink: 1 }}>
      <Txt variant="bodyStrong" tone="primary" style={{ textAlign: 'right' }} numberOfLines={2}>
        {label}
      </Txt>
    </Pressable>
  );
}

function sourceTypeLabel(tr: (k: string) => string, sourceType?: string | null) {
  if (!sourceType) return '—';
  const key = `finance.detail.source_types.${sourceType}`;
  const label = tr(key);
  return label === key ? sourceType : label;
}

/** Plain-text report for the share sheet (mobile stand-in for the web "Print" button). */
function shareText(
  tx: FinanceTransaction,
  tr: (k: string, p?: Record<string, string | number>) => string,
  fmt: { money: (v: string, c?: string) => string; date: (v: string) => string; dateTime: (v: string) => string },
  paymentLabel: string,
) {
  const lines = [
    `${tr('finance.detail.transaction_title')} · ${reportId(tx)}`,
    `${tr('finance.transactions.type')}: ${tr(txnTypeKey(tx.type))} (${tr(txnStatusKey(tx.status))})`,
    `${tr('finance.transactions.amount')}: ${fmt.money(tx.amount, tx.currency)}`,
    `${tr('finance.transactions.date')}: ${fmt.date(`${tx.transaction_date}T12:00:00`)}`,
    `${tr('finance.transactions.account')}: ${tx.account_name}`,
    tx.type === 'transfer' ? `${tr('finance.transfers.to')}: ${tx.counter_account_name ?? '—'}` : `${tr('finance.transactions.category')}: ${tx.category_name ?? '—'}`,
    `${tr('finance.detail.payment_method')}: ${paymentLabel}`,
    tx.reference_no ? `${tr('finance.detail.reference_no')}: ${tx.reference_no}` : null,
    tx.description ? `${tr('finance.transactions.description')}: ${tx.description}` : null,
    tx.voided_at ? `${tr('finance.detail.voided_at')}: ${fmt.dateTime(tx.voided_at)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
