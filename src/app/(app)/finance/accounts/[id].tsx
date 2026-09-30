import { router, useLocalSearchParams } from 'expo-router';
import { Archive, ArchiveRestore, ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Banknote, Landmark, Pencil, Star, Trash2 } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Amount, Badge, Card, ErrorState, Group, Header, IconButton, InfoRow, KpiTile, ListRow, ListSkeleton, Row, Screen, Section, Txt, useConfirm } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { AccountSheet } from '@/features/finance/components/account-sheet';
import { accountTypeKey } from '@/features/finance/components/finance-parts';
import { LedgerList } from '@/features/finance/components/ledger-list';
import { financeService, type FinanceAccount, type FinanceAccountStats } from '@/features/finance/services/finance.service';
import { qk, useFinanceAccountDetail } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.finance.account');

export default function FinanceAccountDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.detail.account_title')}>
      <AccountDetail />
    </RequirePermission>
  );
}

function AccountDetail() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const query = useFinanceAccountDetail(id);
  const [editOpen, setEditOpen] = useState(false);
  const account = query.data?.account;
  const title = account?.name ?? tr('finance.detail.account_title');

  if (query.isLoading) {
    return (
      <Screen header={<Header title={title} />}>
        <ListSkeleton rows={4} height={96} />
      </Screen>
    );
  }
  if (query.isError || !query.data || !account) {
    return (
      <Screen header={<Header title={title} />}>
        <ErrorState description={tr('finance.detail.account_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Screen
        scroll={false}
        header={
          <Header
            title={title}
            subtitle={tr('finance.detail.account_description')}
            right={canWrite ? <IconButton label={tr('mobile.finance.edit_account')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => setEditOpen(true)} /> : undefined}
          />
        }
      >
        <LedgerList
          scope={{ account_uuid: account.uuid }}
          perspective={account.uuid}
          title={tr('finance.detail.account_ledger')}
          onRefresh={() => query.refetch()}
          header={<AccountSummary account={account} stats={query.data.stats} canWrite={canWrite} onEdit={() => setEditOpen(true)} />}
        />
      </Screen>
      <AccountSheet visible={editOpen} onClose={() => setEditOpen(false)} account={account} />
    </View>
  );
}

function AccountSummary({
  account,
  stats,
  canWrite,
  onEdit,
}: {
  account: FinanceAccount;
  stats: FinanceAccountStats;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const confirm = useConfirm();
  const negative = account.negative_balance || toNumber(account.current_balance) < 0;
  const cur = account.currency;

  const patch = useApiMutation({
    key: 'finance.account.patch',
    fn: (body: Record<string, unknown>) => financeService.patchAccount(account.uuid, body),
    invalidate: [qk.finance, qk.reports],
    success: tr('mobile.finance.account_updated'),
    toastValidation: true,
    onSuccess: (a) => log.info('account patched', { uuid: a.uuid, is_default: a.is_default, is_active: a.is_active }),
  });
  const remove = useApiMutation({
    key: 'finance.account.delete',
    fn: () => financeService.deleteAccount(account.uuid),
    invalidate: [qk.finance, qk.reports],
    success: tr('mobile.finance.account_deleted'),
    toastValidation: true,
    onSuccess: () => {
      log.info('account deleted', { uuid: account.uuid });
      router.back();
    },
  });

  const onDelete = async () => {
    const ok = await confirm({
      title: tr('finance.accounts.delete_title'),
      message: tr('finance.accounts.delete_description', { name: account.name }),
      confirmLabel: tr('common.delete'),
      destructive: true,
    });
    if (ok) remove.mutate(undefined);
  };

  const onToggleActive = async () => {
    if (account.is_active) {
      const ok = await confirm({
        title: tr('mobile.finance.deactivate_account'),
        message: tr('mobile.finance.deactivate_account_description', { name: account.name }),
        confirmLabel: tr('mobile.finance.deactivate_account'),
        destructive: true,
      });
      if (!ok) return;
    }
    patch.mutate({ is_active: !account.is_active });
  };

  const busy = patch.isPending || remove.isPending;

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.md}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: account.type === 'bank' ? t.colors.infoBg : t.colors.successBg,
            }}
          >
            {account.type === 'bank' ? <Landmark size={22} color={t.colors.info} /> : <Banknote size={22} color={t.colors.success} />}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="caption" tone="secondary">
              {tr('finance.accounts.current_balance')}
            </Txt>
            <Amount value={account.current_balance} currency={cur} variant="display" tone={negative ? 'danger' : 'default'} />
          </View>
        </Row>
        <Row gap={t.spacing.sm} wrap>
          <Badge size="sm" tone="neutral" label={tr(accountTypeKey(account.type))} />
          {account.is_default ? <Badge size="sm" tone="primary" label={tr('finance.accounts.default')} /> : null}
          <Badge size="sm" tone={account.is_active ? 'success' : 'neutral'} label={account.is_active ? tr('finance.filters.active') : tr('finance.filters.inactive')} />
          {negative ? <Badge size="sm" tone="warning" label={tr('finance.detail.negative_balance')} /> : null}
        </Row>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
        <KpiTile tone="success" icon={<ArrowDownLeft size={16} color={t.colors.success} />} label={tr('finance.detail.total_income')} value={<Amount value={stats.total_income} currency={cur} variant="title" />} />
        <KpiTile tone="danger" icon={<ArrowUpRight size={16} color={t.colors.danger} />} label={tr('finance.detail.total_expense')} value={<Amount value={stats.total_expense} currency={cur} variant="title" />} />
        <KpiTile label={tr('finance.detail.posted_count')} value={fmt.number(stats.posted_count)} />
        <KpiTile label={tr('finance.detail.void_count')} value={fmt.number(stats.void_count)} />
      </View>

      {canWrite && account.is_active ? (
        <Row gap={t.spacing.sm}>
          <QuickAction label={tr('finance.actions.add_income')} icon={<ArrowDownLeft size={18} color={t.colors.success} />} onPress={() => router.push({ pathname: '/finance/transactions/new', params: { type: 'income', account: account.uuid } })} />
          <QuickAction label={tr('finance.actions.add_expense')} icon={<ArrowUpRight size={18} color={t.colors.danger} />} onPress={() => router.push({ pathname: '/finance/transactions/new', params: { type: 'expense', account: account.uuid } })} />
          <QuickAction label={tr('finance.actions.transfer')} icon={<ArrowRightLeft size={18} color={t.colors.info} />} onPress={() => router.push({ pathname: '/finance/transfer', params: { from: account.uuid } })} />
        </Row>
      ) : null}

      <Section title={tr('finance.detail.account_info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('finance.accounts.currency')} value={account.currency} />
          <InfoRow label={tr('finance.accounts.opening_balance')} value={fmt.money(account.opening_balance, cur)} />
          <InfoRow label={tr('finance.detail.bank_name')} value={account.bank_name ?? '—'} />
          <InfoRow label={tr('finance.detail.iban')}>
            <Txt variant="mono" selectable style={{ flexShrink: 1, textAlign: 'right', fontSize: 13 }}>
              {account.iban || '—'}
            </Txt>
          </InfoRow>
          <InfoRow label={tr('finance.detail.notes')} value={account.notes || '—'} />
          <InfoRow label={tr('finance.detail.created_at')} value={fmt.dateTime(account.created_at)} last />
        </Card>
      </Section>

      <Section title={tr('finance.detail.transfer_flow')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('finance.detail.transfer_in')} value={fmt.money(stats.transfer_in, cur)} />
          <InfoRow label={tr('finance.detail.transfer_out')} value={fmt.money(stats.transfer_out, cur)} />
          <InfoRow label={tr('finance.detail.void_count')} value={fmt.number(stats.void_count)} last />
        </Card>
      </Section>

      {canWrite ? (
        <Section title={tr('mobile.finance.manage')}>
          <Group>
            {!account.is_default && account.is_active ? (
              <ListRow title={tr('mobile.finance.set_default')} subtitle={tr('mobile.finance.default_hint')} left={<Star size={20} color={t.colors.primary} />} onPress={() => patch.mutate({ is_default: true })} disabled={busy} chevron={false} />
            ) : null}
            {!account.is_default ? (
              <ListRow
                title={account.is_active ? tr('mobile.finance.deactivate_account') : tr('mobile.finance.activate_account')}
                left={account.is_active ? <Archive size={20} color={t.colors.warning} /> : <ArchiveRestore size={20} color={t.colors.success} />}
                onPress={onToggleActive}
                disabled={busy}
                chevron={false}
              />
            ) : null}
            <ListRow title={tr('mobile.finance.edit_account')} left={<Pencil size={20} color={t.colors.text} />} onPress={onEdit} disabled={busy} chevron={false} last={account.is_default} />
            {!account.is_default ? (
              <ListRow title={tr('finance.accounts.delete_title')} destructive left={<Trash2 size={20} color={t.colors.danger} />} onPress={onDelete} disabled={busy} chevron={false} last />
            ) : null}
          </Group>
        </Section>
      ) : null}
    </View>
  );
}

function QuickAction({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: t.spacing.md, paddingHorizontal: t.spacing.sm }}>
      {icon}
      <Txt variant="caption" style={{ fontWeight: '700', textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Txt>
    </Card>
  );
}
