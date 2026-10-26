import { router } from 'expo-router';
import { FilePlus2, PackageSearch, Settings2 } from 'lucide-react-native';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, Screen, SearchBar, Txt, useConfirm } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ModuleGate } from '@/features/billing/components/module-gate';
import { useLiveResource } from '@/features/live/use-live-resource';
import { ReorderOverrideSheet, ReorderSettingsSheet } from '@/features/stock-reorder/components/sheets';
import { SuggestionCard, URGENCY_KEYS } from '@/features/stock-reorder/components/suggestion-card';
import { draftItems, groupBySupplier, missingSupplier, type SupplierSection } from '@/features/stock-reorder/lib/reorder';
import { useReorderAccess, useReorderMutations, useReorderSuggestions, useReorderSummary } from '@/features/stock-reorder/queries';
import type { ReorderSuggestion, ReorderUrgencyFilter } from '@/features/stock-reorder/types';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.stock_reorder');
const URGENCY_TABS = ['all', 'out_of_stock', 'below_min', 'low_cover'] as const;
type UrgencyTab = (typeof URGENCY_TABS)[number];

export default function StockReorderScreen() {
  useLiveResource(['tenant.stock_reorder', 'tenant.catalog.products', 'tenant.purchases']);
  const { t: tr } = useLocale();
  const summary = useReorderSummary();
  return (
    <RequirePermission gate={P.purchasesRead} title={tr('stock_reorder.title')}>
      <RequirePermission gate={P.catalogRead} title={tr('stock_reorder.title')}>
        <ModuleGate feature="stock_reorder.enabled" title={tr('stock_reorder.title')} probe={summary}>
          <ReorderList />
        </ModuleGate>
      </RequirePermission>
    </RequirePermission>
  );
}

/** Web `StockReorderPage`: suggestions grouped by supplier, urgency chips, quantity steppers, select → drafts. */
function ReorderList() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { t: tr, fmt, locale } = useLocale();
  const confirm = useConfirm();
  const { canWrite } = useReorderAccess();
  const [urgency, setUrgency] = useState<UrgencyTab>('all');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const list = useReorderSuggestions({ urgency: urgency === 'all' ? undefined : (urgency as ReorderUrgencyFilter), q: query || undefined });
  const { createDrafts } = useReorderMutations();
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overrideItem, setOverrideItem] = useState<ReorderSuggestion | null>(null);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const summary = list.data?.summary;
  const qtyOf = useCallback((s: ReorderSuggestion) => qtyEdits[s.product_uuid] ?? s.suggested_qty, [qtyEdits]);
  const sections = useMemo(() => groupBySupplier(items, qtyOf, tr('stock_reorder.no_supplier'), locale), [items, qtyOf, tr, locale]);

  const toggle = useCallback((uuid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);
  const toggleSection = (section: SupplierSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = section.data.every((i) => next.has(i.product_uuid));
      for (const i of section.data) {
        if (all) next.delete(i.product_uuid);
        else next.add(i.product_uuid);
      }
      return next;
    });
  };
  const onQty = useCallback((uuid: string, qty: string) => setQtyEdits((prev) => ({ ...prev, [uuid]: qty })), []);

  const body = draftItems(items, selected, qtyOf);
  const create = async () => {
    const missing = missingSupplier(items, selected);
    if (missing.length) {
      await confirm({
        title: tr('stock_reorder.drafts_dialog.missing_supplier_title'),
        message: tr('stock_reorder.drafts_dialog.missing_supplier', { names: missing.slice(0, 5).map((m) => m.name).join(', ') }),
        confirmLabel: tr('common.close'),
      });
      return;
    }
    if (!body.length) return;
    const suppliers = new Set(items.filter((i) => body.some((b) => b.product_uuid === i.product_uuid)).map((i) => i.supplier?.uuid)).size;
    const ok = await confirm({
      title: tr('stock_reorder.drafts_dialog.title'),
      message: tr('stock_reorder.drafts_dialog.description', { products: body.length, suppliers }),
      confirmLabel: tr('stock_reorder.actions.create_drafts'),
    });
    if (!ok) return;
    createDrafts.mutate(
      { items: body },
      {
        onSuccess: (res) => {
          log.info('drafts created', { count: res.drafts.length });
          setSelected(new Set());
          setQtyEdits({});
          router.push('/purchases/reorder/drafts');
        },
      },
    );
  };

  const header = (
    <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
      <Row gap={t.spacing.sm} wrap>
        <Badge tone={summary?.out_of_stock ? 'danger' : 'neutral'} label={`${tr('stock_reorder.urgency.out_of_stock')}: ${summary?.out_of_stock ?? 0}`} />
        <Badge tone={summary?.below_min ? 'warning' : 'neutral'} label={`${tr('stock_reorder.urgency.below_min')}: ${summary?.below_min ?? 0}`} />
        <Badge tone={summary?.low_cover ? 'warning' : 'neutral'} label={`${tr('stock_reorder.urgency.low_cover')}: ${summary?.low_cover ?? 0}`} />
      </Row>
      <SearchBar value={q} onChangeText={setQ} placeholder={tr('stock_reorder.search_placeholder')} />
      <FilterChips<UrgencyTab>
        value={urgency}
        onChange={setUrgency}
        options={URGENCY_TABS.map((v) => ({ value: v, label: v === 'all' ? tr('stock_reorder.filter.all') : tr(URGENCY_KEYS[v]) }))}
      />
      {canWrite ? (
        <Txt variant="caption" tone="secondary">
          {selected.size ? tr('stock_reorder.selected', { count: selected.size }) : tr('stock_reorder.select_hint')}
        </Txt>
      ) : null}
    </View>
  );

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('stock_reorder.title')}
          subtitle={summary?.drafts ? tr('mobile.reorder.drafts_open', { count: summary.drafts }) : tr('mobile.reorder.subtitle')}
          right={
            <Row gap={t.spacing.xs}>
              <IconButton label={tr('stock_reorder.tabs.drafts')} icon={<FilePlus2 size={20} color={t.colors.text} />} onPress={() => router.push('/purchases/reorder/drafts')} />
              <IconButton label={tr('stock_reorder.actions.settings')} icon={<Settings2 size={20} color={t.colors.text} />} onPress={() => setSettingsOpen(true)} />
            </Row>
          }
        />
      }
      footer={
        canWrite && selected.size > 0 ? (
          <Button
            label={`${tr('stock_reorder.actions.create_drafts')} (${body.length})`}
            icon={<FilePlus2 size={18} color={t.colors.onPrimary} />}
            onPress={() => void create()}
            loading={createDrafts.isPending}
            disabled={!body.length}
            fullWidth
          />
        ) : undefined
      }
    >
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.product_uuid}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xxxl + insets.bottom, gap: t.spacing.sm }}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        renderSectionHeader={({ section }) => {
          const all = section.data.every((i) => selected.has(i.product_uuid));
          return (
            <Row gap={t.spacing.sm} style={{ paddingTop: t.spacing.md, paddingBottom: t.spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Txt variant="heading" numberOfLines={1}>
                  {section.title}
                </Txt>
                <Txt variant="caption" tone="secondary">
                  {tr('stock_reorder.group_summary', { count: section.data.length, total: fmt.money(section.total, section.data[0]?.currency ?? 'TRY') })}
                </Txt>
              </View>
              {canWrite ? (
                <Pressable onPress={() => toggleSection(section)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
                    {all ? tr('mobile.reorder.clear_group') : tr('mobile.reorder.select_group')}
                  </Txt>
                </Pressable>
              ) : null}
            </Row>
          );
        }}
        renderItem={({ item }) => (
          <SuggestionCard item={item} qty={qtyOf(item)} selected={selected.has(item.product_uuid)} canWrite={canWrite} onToggle={toggle} onQty={onQty} onSettings={setOverrideItem} />
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={4} height={180} />
          ) : list.isError ? (
            <ErrorState error={list.error} description={tr('stock_reorder.error')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState icon={<PackageSearch size={28} color={t.colors.textMuted} />} title={tr('stock_reorder.empty_title')} description={tr('mobile.reorder.empty_hint')} />
          )
        }
      />
      <ReorderSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} canWrite={canWrite} />
      <ReorderOverrideSheet item={overrideItem} onClose={() => setOverrideItem(null)} />
    </Screen>
  );
}
