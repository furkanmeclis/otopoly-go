import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, SelectField, Segmented, Sheet, Txt } from '@/components/ui';
import { MONEY_KEYS, useFinanceAccounts } from '@/features/queries';
import { jobsService, type CloseJobInput, type Job } from '@/features/jobs/services/jobs.service';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

type Method = CloseJobInput['method'];

/** Record payment without changing delivery status (web CloseJobDialog). */
export function CloseJobSheet({ job, visible, onClose }: { job: Job | null; visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const accounts = useFinanceAccounts(true);
  const items = useMemo(() => accounts.data?.items ?? [], [accounts.data]);
  const [method, setMethod] = useState<Method>('cash');
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default account follows the method: cash → default cash drawer, card → default bank/POS.
  const defaultAccount = useMemo(() => {
    const want = method === 'card' ? 'bank' : 'cash';
    return (items.find((a) => a.type === want && a.is_default) ?? items.find((a) => a.type === want) ?? items.find((a) => a.is_default) ?? items[0])?.uuid ?? null;
  }, [method, items]);
  const account = picked ?? defaultAccount;

  const dismiss = () => {
    setMethod('cash');
    setPicked(null);
    setError(null);
    onClose();
  };

  const close = useApiMutation({
    key: 'jobs.close',
    fn: (body: CloseJobInput) => jobsService.close(job!.uuid, body),
    invalidate: MONEY_KEYS,
    success: tr('jobs.toast.closed'),
    onSuccess: dismiss,
  });

  const submit = () => {
    if (method !== 'cari' && !account) {
      setError(tr('jobs.validation.finance_account'));
      return;
    }
    close.mutate({ method, finance_account_uuid: method === 'cari' ? undefined : (account ?? undefined) });
  };

  return (
    <Sheet
      visible={visible}
      onClose={dismiss}
      title={tr('jobs.actions.close')}
      footer={<Button label={tr('jobs.actions.close')} onPress={submit} loading={close.isPending} size="lg" />}
    >
      <Txt tone="secondary">{tr('jobs.close.description')}</Txt>
      {job ? (
        <View style={{ alignItems: 'center', gap: 4, paddingVertical: t.spacing.md }}>
          <Txt variant="caption" tone="secondary">
            {job.plate} · {job.customer_name}
          </Txt>
          <Txt variant="display" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt.money(job.total_amount, job.currency)}
          </Txt>
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('jobs.close.method')}
        </Txt>
        <Segmented<Method>
          value={method}
          onChange={(m) => {
            setMethod(m);
            setPicked(null);
          }}
          options={(['cash', 'card', 'cari'] as const).map((m) => ({ value: m, label: tr(`jobs.method.${m}`) }))}
        />
      </View>
      {method !== 'cari' ? (
        <SelectField
          label={tr('jobs.finance_account')}
          placeholder={tr('jobs.pick_finance_account')}
          value={account}
          onChange={(v) => {
            setPicked(v);
            setError(null);
          }}
          error={error}
          required
          options={items.map((a) => ({ value: a.uuid, label: a.name, description: fmt.money(a.current_balance, a.currency) }))}
        />
      ) : null}
    </Sheet>
  );
}
