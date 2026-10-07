import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Plus, Tag } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, EmptyState, ErrorState, FilterChips, Group, Header, IconButton, ListRow, ListSkeleton, Screen, SearchBar, Section, Segmented } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { CategorySheet } from '@/features/finance/components/category-sheet';
import { useAllFinanceCategories } from '@/features/finance/queries';
import type { FinanceCategory } from '@/features/finance/services/finance.service';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type KindFilter = 'all' | 'income' | 'expense';
type SortKey = 'sort_order' | 'name';

export default function FinanceCategoriesScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.financeRead} title={tr('finance.categories.title')}>
      <CategoriesList />
    </RequirePermission>
  );
}

function CategoriesList() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canWrite = can({ perm: P.financeWrite, owner: true });
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('sort_order');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const list = useAllFinanceCategories();

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr-TR');
    const items = (list.data?.items ?? []).filter((c) => (kind === 'all' || c.kind === kind) && (!needle || c.name.toLocaleLowerCase('tr-TR').includes(needle)));
    return [...items].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'tr') : a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr')));
  }, [list.data?.items, kind, sort, q]);

  const groups: { kind: 'income' | 'expense'; items: FinanceCategory[] }[] = (['income', 'expense'] as const)
    .filter((k) => kind === 'all' || kind === k)
    .map((k) => ({ kind: k, items: filtered.filter((c) => c.kind === k) }));

  return (
    <Screen
      header={
        <Header
          title={tr('finance.categories.title')}
          subtitle={list.data ? tr('finance.categories.count', { count: list.data.items.length }) : tr('finance.categories.subtitle')}
          right={
            canWrite ? (
              <IconButton variant="primary" label={tr('finance.categories.create')} icon={<Plus size={20} color={t.colors.onPrimary} />} onPress={() => setCreateOpen(true)} />
            ) : undefined
          }
        />
      }
      refreshing={list.isRefetching}
      onRefresh={() => qc.invalidateQueries({ queryKey: [...qk.finance, 'categories-all'] })}
    >
      <View style={{ gap: t.spacing.md }}>
        <Segmented<KindFilter>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: tr('mobile.common.all') },
            { value: 'income', label: tr('finance.categories.kind_income') },
            { value: 'expense', label: tr('finance.categories.kind_expense') },
          ]}
        />
        <SearchBar value={q} onChangeText={setQ} placeholder={tr('finance.categories.name')} />
        <FilterChips<SortKey>
          value={sort}
          onChange={setSort}
          options={[
            { value: 'sort_order', label: tr('finance.categories.sort_order') },
            { value: 'name', label: tr('mobile.finance.sort_name') },
          ]}
        />
      </View>

      {list.isLoading ? (
        <ListSkeleton rows={6} height={52} />
      ) : list.isError ? (
        <ErrorState error={list.error} description={tr('finance.categories.error_description')} onRetry={() => list.refetch()} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Tag size={28} color={t.colors.textMuted} />}
          title={tr('finance.categories.empty')}
          description={tr('finance.categories.empty_description')}
          action={canWrite ? <Button label={tr('finance.categories.create')} onPress={() => setCreateOpen(true)} /> : undefined}
        />
      ) : (
        groups.map((g) => (
          <Section key={g.kind} title={`${tr(g.kind === 'income' ? 'finance.categories.income_list' : 'finance.categories.expense_list')} · ${g.items.length}`}>
            {g.items.length === 0 ? (
              <Group>
                <EmptyState
                  title={q ? tr('finance.categories.empty') : tr(g.kind === 'income' ? 'finance.categories.empty_income' : 'finance.categories.empty_expense')}
                  description={q ? undefined : tr(g.kind === 'income' ? 'finance.categories.empty_income_description' : 'finance.categories.empty_expense_description')}
                />
              </Group>
            ) : (
              <Group>
                {g.items.map((c, i) => (
                  <ListRow
                    key={c.uuid}
                    title={c.name}
                    subtitle={`${tr('finance.categories.sort_order')}: ${c.sort_order}`}
                    left={
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: c.kind === 'income' ? t.colors.successBg : t.colors.dangerBg,
                        }}
                      >
                        <Tag size={18} color={c.kind === 'income' ? t.colors.success : t.colors.danger} />
                      </View>
                    }
                    right={!c.is_active ? <Badge size="sm" tone="neutral" label={tr('finance.filters.inactive')} /> : undefined}
                    onPress={() => router.push(`/finance/categories/${c.uuid}`)}
                    last={i === g.items.length - 1}
                  />
                ))}
              </Group>
            )}
          </Section>
        ))
      )}
      <CategorySheet visible={createOpen} onClose={() => setCreateOpen(false)} defaultKind={kind === 'income' ? 'income' : 'expense'} />
    </Screen>
  );
}
