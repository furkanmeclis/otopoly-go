/** Optional, clearable link pickers (web AsyncCombobox with `clearable`) for customer / lead / quote refs. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { SelectField, type SelectOption } from '@/components/ui';
import { leadsService } from '@/features/leads/services/leads.service';
import { qk, useCustomersSearch } from '@/features/queries';
import { quotesService } from '@/features/quotes/services/quotes.service';

export type Ref = { uuid: string; label: string };

type PickerProps = {
  label: string;
  placeholder: string;
  value: Ref | null;
  onChange: (ref: Ref | null) => void;
  disabled?: boolean;
};

function withSelected(options: SelectOption[], value: Ref | null) {
  return value && !options.some((o) => o.value === value.uuid) ? [{ value: value.uuid, label: value.label }, ...options] : options;
}

function RefSelect({ label, placeholder, value, onChange, disabled, options, loading, onSearch }: PickerProps & { options: SelectOption[]; loading: boolean; onSearch: (q: string) => void }) {
  const merged = useMemo(() => withSelected(options, value), [options, value]);
  return (
    <SelectField
      label={label}
      placeholder={placeholder}
      value={value?.uuid ?? null}
      options={merged}
      onSearch={onSearch}
      loading={loading}
      allowClear
      disabled={disabled}
      onChange={(v, opt) => onChange(v ? { uuid: v, label: opt?.label ?? merged.find((o) => o.value === v)?.label ?? '' } : null)}
    />
  );
}

export function CustomerRefPicker(props: PickerProps) {
  const [q, setQ] = useState('');
  const search = useCustomersSearch(q.trim());
  const options = useMemo(
    () => (search.data?.items ?? []).map((c) => ({ value: c.uuid, label: c.name, description: c.phone || undefined })),
    [search.data],
  );
  return <RefSelect {...props} options={options} loading={search.isFetching} onSearch={setQ} />;
}

export function LeadRefPicker(props: PickerProps) {
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: [...qk.leads, 'pick', q.trim()],
    queryFn: () => leadsService.list({ q: q.trim() || undefined, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const options = useMemo(
    () => (list.data?.items ?? []).map((l) => ({ value: l.uuid, label: [l.customer_name, l.vehicle_plate || l.interest].filter(Boolean).join(' · ') })),
    [list.data],
  );
  return <RefSelect {...props} options={options} loading={list.isFetching} onSearch={setQ} />;
}

export function QuoteRefPicker(props: PickerProps) {
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: [...qk.quotes, 'pick', q.trim()],
    queryFn: () => quotesService.list({ q: q.trim() || undefined, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const options = useMemo(() => (list.data?.items ?? []).map((x) => ({ value: x.uuid, label: `${x.number} · ${x.customer_name}` })), [list.data]);
  return <RefSelect {...props} options={options} loading={list.isFetching} onSearch={setQ} />;
}
