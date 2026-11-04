import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button, DateField, FilterChips, Row, Segmented, SelectField, Sheet, Txt } from '@/components/ui';
import { CURRENCIES, financeMonthStart, financeToday } from '@/features/finance/lib';
import type { ReportsOverviewFilters } from '@/features/reports/services/reports.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Web `DraftFilters`: empty string / "all" mean "no filter". */
export type ReportDraft = {
  date_from: string;
  date_to: string;
  currency: string;
  payment_method: string;
  account_uuid: string;
  source_type: string;
  granularity: 'day' | 'week' | 'month';
};

export const defaultDraft = (): ReportDraft => ({
  date_from: financeMonthStart(),
  date_to: financeToday(),
  currency: '',
  payment_method: 'all',
  account_uuid: '',
  source_type: 'all',
  granularity: 'day',
});

export function toQuery(d: ReportDraft): ReportsOverviewFilters {
  return {
    date_from: d.date_from,
    date_to: d.date_to,
    currency: d.currency || undefined,
    payment_method: d.payment_method && d.payment_method !== 'all' ? d.payment_method : undefined,
    account_uuid: d.account_uuid || undefined,
    source_type: d.source_type && d.source_type !== 'all' ? d.source_type : undefined,
    granularity: d.granularity || 'day',
  };
}

const METHODS = ['all', 'cash', 'card', 'cari'] as const;
const SOURCES = ['all', 'manual', 'service_job', 'product_sale', 'purchase', 'cari_payment'] as const;

/** All web report filters in one sheet; "Apply" commits, "Reset" goes back to this month. */
export function ReportFilterSheet({
  visible,
  onClose,
  value,
  onApply,
  accounts,
}: {
  visible: boolean;
  onClose: () => void;
  value: ReportDraft;
  onApply: (d: ReportDraft) => void;
  accounts: { value: string; label: string }[];
}) {
  if (!visible) return null;
  return <Content onClose={onClose} value={value} onApply={onApply} accounts={accounts} />;
}

function Content({ onClose, value, onApply, accounts }: { onClose: () => void; value: ReportDraft; onApply: (d: ReportDraft) => void; accounts: { value: string; label: string }[] }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [d, setD] = useState<ReportDraft>(value);
  const set = <K extends keyof ReportDraft>(k: K, v: ReportDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const rangeError = d.date_from > d.date_to ? tr('mobile.finance.date_range_invalid') : null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={tr('reports.filters.title')}
      footer={
        <Row gap={t.spacing.sm}>
          <Button style={{ flex: 1 }} variant="outline" label={tr('reports.filters.reset')} onPress={() => onApply(defaultDraft())} />
          <Button style={{ flex: 1 }} label={tr('reports.filters.apply')} disabled={Boolean(rangeError)} onPress={() => onApply(d)} />
        </Row>
      }
    >
      <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <DateField label={tr('reports.filters.date_from')} value={d.date_from} onChange={(v) => set('date_from', v ?? financeMonthStart())} error={rangeError} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label={tr('reports.filters.date_to')} value={d.date_to} onChange={(v) => set('date_to', v ?? financeToday())} />
        </View>
      </Row>
      <Labeled label={tr('reports.filters.currency')}>
        <FilterChips<string>
          value={d.currency || 'all'}
          onChange={(v) => set('currency', v === 'all' ? '' : v)}
          options={[{ value: 'all', label: tr('reports.filters.currency_all') }, ...CURRENCIES.map((c) => ({ value: c, label: c }))]}
        />
      </Labeled>
      <Labeled label={tr('reports.filters.payment_method')}>
        <FilterChips<string>
          value={d.payment_method}
          onChange={(v) => set('payment_method', v)}
          options={METHODS.map((m) => ({ value: m, label: m === 'all' ? tr('reports.filters.payment_all') : tr(`reports.method.${m}`) }))}
        />
      </Labeled>
      <Labeled label={tr('reports.filters.source_type')}>
        <FilterChips<string>
          value={d.source_type}
          onChange={(v) => set('source_type', v)}
          options={SOURCES.map((s) => ({ value: s, label: s === 'all' ? tr('reports.filters.source_all') : tr(`reports.source.${s}`) }))}
        />
      </Labeled>
      <SelectField
        label={tr('reports.filters.account')}
        value={d.account_uuid || null}
        onChange={(v) => set('account_uuid', v ?? '')}
        options={accounts}
        placeholder={tr('reports.filters.account_all')}
        allowClear
      />
      <Labeled label={tr('reports.filters.granularity')}>
        <Segmented<ReportDraft['granularity']>
          value={d.granularity}
          onChange={(v) => set('granularity', v)}
          options={[
            { value: 'day', label: tr('reports.filters.granularity_day') },
            { value: 'week', label: tr('reports.filters.granularity_week') },
            { value: 'month', label: tr('reports.filters.granularity_month') },
          ]}
        />
      </Labeled>
    </Sheet>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}
