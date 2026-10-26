import { X } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import { Field, SelectField } from '@/components/ui';
import { Chip, ChipRow } from '@/features/leads/components/crm-ui';
import { useCatalogCategories, useServices } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Ref = { uuid: string; name: string };

/** Several catalog refs as removable chips plus an "add" picker. */
function MultiRefField({ label, hint, placeholder, options, value, onChange, error }: { label: string; hint?: string; placeholder: string; options: Ref[]; value: string[]; onChange: (v: string[]) => void; error?: string | null }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const byId = useMemo(() => new Map(options.map((o) => [o.uuid, o])), [options]);
  const left = options.filter((o) => !value.includes(o.uuid));
  return (
    <Field label={label} hint={hint} error={error}>
      <View style={{ gap: t.spacing.sm }}>
        {value.length ? (
          <ChipRow>
            {value.map((id) => {
              const name = byId.get(id)?.name ?? '—';
              return (
                <Chip
                  key={id}
                  active
                  label={name}
                  icon={<X size={13} color={t.colors.primary} />}
                  accessibilityLabel={`${tr('loyalty.actions.remove')}: ${name}`}
                  onPress={() => onChange(value.filter((v) => v !== id))}
                />
              );
            })}
          </ChipRow>
        ) : null}
        <SelectField value={null} placeholder={placeholder} searchable options={left.map((o) => ({ value: o.uuid, label: o.name }))} onChange={(v) => v && onChange([...value, v])} />
      </View>
    </Field>
  );
}

/** Eligible services and service categories of a campaign / plan. */
export function EligibilityPicker({
  services,
  categories,
  onServices,
  onCategories,
  error,
}: {
  services: string[];
  categories: string[];
  onServices: (v: string[]) => void;
  onCategories: (v: string[]) => void;
  error?: string | null;
}) {
  const { t: tr } = useLocale();
  const svc = useServices({ is_active: 'true' });
  const cats = useCatalogCategories('service');
  const serviceOptions = useMemo(() => (svc.data?.items ?? []).map((s) => ({ uuid: s.uuid, name: s.name })), [svc.data]);
  const categoryOptions = useMemo(() => (cats.data?.items ?? []).map((c) => ({ uuid: c.uuid, name: c.name })), [cats.data]);
  return (
    <>
      <MultiRefField
        label={tr('loyalty.fields.categories')}
        hint={tr('loyalty.fields.categories_hint')}
        placeholder={tr('loyalty.fields.pick_category')}
        options={categoryOptions}
        value={categories}
        onChange={onCategories}
      />
      <MultiRefField
        label={tr('loyalty.fields.services')}
        hint={tr('loyalty.fields.services_hint')}
        placeholder={tr('loyalty.fields.pick_service')}
        options={serviceOptions}
        value={services}
        onChange={onServices}
        error={error}
      />
    </>
  );
}
